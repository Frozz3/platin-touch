// Platin Touch – DeSmuME-Kern als WebAssembly, schlanke C-Schnittstelle für die Web-App.
// Grundlage: DeSmuME-wasm (https://github.com/44670/desmume-wasm, GPL-2.0), Frontend-Teil neu geschrieben.
//
// Schnittstelle (alle extern "C"):
//   pt_init()                         Kern starten (einmal)
//   pt_romBuffer(len) -> ptr          Puffer für die ROM-Datei holen, dann pt_loadRom(len)
//   pt_loadRom(len) -> 0 | Fehler
//   pt_runFrame(draw, keys, touched, x, y)   ein Bild emulieren (keys: Bitmaske siehe unten)
//   pt_frame() -> ptr                 256x384 RGBA (oben = obere DS-Anzeige, unten = Touchscreen)
//   pt_audio(maxSamples) -> n         n Stereo-Abtastwerte (s16) in pt_audioBuf()
//   pt_sav*()                         Batteriespeicher (DeSmuME-Format mit Fußzeile)
//   pt_stateSave()/pt_stateLoad()     Schnellspeicher
//   pt_mainRam() -> ptr               4 MB Arbeitsspeicher des DS (0x02000000)

#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "../src/utils/colorspacehandler/colorspacehandler.h"
#include "MMU.h"
#include "NDSSystem.h"
#include "SPU.h"
#include "GPU.h"
#include "mc.h"
#include "rasterize.h"
#include "saves.h"
#include "emufile.h"
#include "firmware.h"
#include "movie.h"

int DESMUME_SAMPLE_RATE = 48000;
extern double samples_per_hline;

EMUFILE_MEMORY *savFile = new EMUFILE_MEMORY();
u8 *romBuffer = NULL;
int romBufferCap = 0;
int romLen = 0;
volatile bool execute = true;
volatile bool paused = false;
int emuLastError = 0;

static s16 audioBuffer[16384 * 2];
static int samplesRead = 0;
static int samplesDesired = 0;

static void SNDWasmUpdateAudio(s16 *buffer, u32 num_samples) {
  if (num_samples > 16384) num_samples = 16384;
  samplesRead = num_samples;
  memcpy(audioBuffer, buffer, sizeof(s16) * num_samples * 2);
}
static u32 SNDWasmGetAudioSpace() { return samplesDesired; }
static int SNDWasmInit(int) { return 0; }
static void SNDWasmDeInit() {}
static void SNDWasmMuteAudio() {}
static void SNDWasmUnMuteAudio() {}
static void SNDWasmSetVolume(int) {}
static void SNDWasmClearBuffer() {}

SoundInterface_struct SndWasm = {1,
                                 "Wasm Sound Interface",
                                 SNDWasmInit,
                                 SNDWasmDeInit,
                                 SNDWasmUpdateAudio,
                                 SNDWasmGetAudioSpace,
                                 SNDWasmMuteAudio,
                                 SNDWasmUnMuteAudio,
                                 SNDWasmSetVolume,
                                 SNDWasmClearBuffer,
                                 NULL,
                                 NULL};

SoundInterface_struct *SNDCoreList[] = {&SNDDummy, &SndWasm, NULL};
GPU3DInterface *core3DList[] = {&gpu3DNull, &gpu3DRasterize, NULL};

// Mikrofon wird nicht gebraucht: Stille (Mittelwert des 7-Bit-Formats)
u8 Mic_ReadSample() { return 64; }

// Die selbst gebaute ROM hat den Secure Area bereits entschlüsselt (E7FFDEFF am Anfang).
bool DecryptSecureArea(u8 *romheader, u8 *secure) {
  const u32 *w = (const u32 *)secure;
  if (w[0] == 0xE7FFDEFF && w[1] == 0xE7FFDEFF) return true;
  printf("Secure Area verschluesselt - wird nicht unterstuetzt\n");
  return true;
}

extern "C" {

static u32 frameRGBA[256 * 192 * 2];
static EMUFILE_MEMORY *stateFile = NULL;


EMSCRIPTEN_KEEPALIVE int pt_init() {
  srand(time(NULL));
  NDS_Init();
  SPU_ChangeSoundCore(1, 16384);
  GPU->Change3DRendererByID(RENDERID_SOFTRASTERIZER);
  return 0;
}

int main() {
  // Die App ruft pt_init() selbst auf, sobald das Modul geladen ist.
  return 0;
}

EMSCRIPTEN_KEEPALIVE void pt_setSampleRate(int r) {
  DESMUME_SAMPLE_RATE = r;
  samples_per_hline = (DESMUME_SAMPLE_RATE / 59.8261f) / 263.0f;
}

EMSCRIPTEN_KEEPALIVE void *pt_romBuffer(int len) {
  if (len > romBufferCap) {
    romBuffer = (u8 *)realloc((void *)romBuffer, len);
    romBufferCap = len;
  }
  romLen = len;
  return romBuffer;
}

// Firmware-Benutzerdaten (Name, Sprache). Muss vor pt_loadRom gesetzt werden.
EMSCRIPTEN_KEEPALIVE void pt_setFirmware(int language, const char *nick) {
  CommonSettings.fwConfig.language = language;
  if (nick) {
    int n = 0;
    for (; nick[n] && n < 10; n++) CommonSettings.fwConfig.nickname[n] = (u16)(u8)nick[n];
    CommonSettings.fwConfig.nicknameLength = n;
  }
}

EMSCRIPTEN_KEEPALIVE int pt_loadRom(int len) {
  romLen = len;
  if (!NDS_LoadROM("rom.nds")) return -2;
  SPU_SetSynchMode(ESynchMode_Synchronous, ESynchMethod_N);
  SPU_SetVolume(100);
  return 0;
}

EMSCRIPTEN_KEEPALIVE void pt_reset() { NDS_Reset(); }

// keys: Bit 0 Rechts, 1 Links, 2 Unten, 3 Oben, 4 Select, 5 Start, 6 B, 7 A, 8 Y, 9 X, 10 L, 11 R, 12 Debug, 13 Deckel
EMSCRIPTEN_KEEPALIVE int pt_runFrame(int draw, u32 keys, int touched, int tx, int ty) {
  if (!draw) NDS_SkipNextFrame();
  if (touched) {
    if (tx < 0) tx = 0;
    if (tx > 255) tx = 255;
    if (ty < 0) ty = 0;
    if (ty > 191) ty = 191;
    NDS_setTouchPos((u16)tx, (u16)ty);
  } else {
    NDS_releaseTouch();
  }
  NDS_setPad(keys & (1 << 0), keys & (1 << 1), keys & (1 << 2), keys & (1 << 3),
             keys & (1 << 4), keys & (1 << 5), keys & (1 << 6), keys & (1 << 7),
             keys & (1 << 8), keys & (1 << 9), keys & (1 << 10), keys & (1 << 11),
             keys & (1 << 12), keys & (1 << 13));
  NDS_beginProcessingInput();
  NDS_endProcessingInput();
  NDS_exec<false>();
  if (draw) {
    const NDSDisplayInfo &di = GPU->GetDisplayInfo();
    ColorspaceConvertBuffer555To8888Opaque<false, false>((const uint16_t *)di.masterNativeBuffer, frameRGBA, 256 * 192 * 2);
  }
  return 0;
}

EMSCRIPTEN_KEEPALIVE void *pt_frame() { return frameRGBA; }

EMSCRIPTEN_KEEPALIVE void *pt_audioBuf() { return audioBuffer; }

EMSCRIPTEN_KEEPALIVE int pt_audio(int want) {
  if (want > 16384) want = 16384;
  samplesDesired = want;
  samplesRead = 0;
  SPU_Emulate_user();
  return samplesRead;
}

EMSCRIPTEN_KEEPALIVE int pt_savSize() { return (int)savFile->size(); }

EMSCRIPTEN_KEEPALIVE void *pt_savPtr(int desired) {
  if (desired > 0) {
    savFile->truncate(desired);
    savFile->fseek(0, SEEK_SET);
  }
  return savFile->buf();
}

EMSCRIPTEN_KEEPALIVE int pt_savChanged() {
  int r = savFile->changed ? 1 : 0;
  savFile->changed = 0;
  return r;
}

// Batteriespeicher auf die Platte des Emulators zurückschreiben (nach Import)
EMSCRIPTEN_KEEPALIVE int pt_savFlush() {
  MMU_new.backupDevice.flushBackup();
  return 0;
}

// Spielstand aus einer Datei im Emulator-Dateisystem übernehmen (.sav roh, .dsv, .duc) – setzt das Spiel zurück
EMSCRIPTEN_KEEPALIVE int pt_importSave(const char *path) {
  return MMU_new.backupDevice.importData(path, 0) ? 0 : -1;
}

// Spielstand als rohe .sav-Datei (ohne DeSmuME-Fußzeile) ins Emulator-Dateisystem schreiben
EMSCRIPTEN_KEEPALIVE int pt_exportSave(const char *path) {
  return MMU_new.backupDevice.exportData(path) ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE int pt_stateSave() {
  if (stateFile) delete stateFile;
  stateFile = new EMUFILE_MEMORY();
  if (!savestate_save(*stateFile, 1)) return -1;
  return (int)stateFile->size();
}

EMSCRIPTEN_KEEPALIVE void *pt_stateBuf() { return stateFile ? stateFile->buf() : NULL; }

EMSCRIPTEN_KEEPALIVE int pt_stateLoad(u8 *buf, int len) {
  EMUFILE_MEMORY f(len);
  memcpy(f.buf(), buf, len);
  f.fseek(0, SEEK_SET);
  return savestate_load(f) ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE void *pt_mainRam() { return MMU.MAIN_MEM; }

EMSCRIPTEN_KEEPALIVE int pt_mainRamMask() { return (int)_MMU_MAIN_MEM_MASK; }

// Lesen/Schreiben über den ARM9-Bus (für Adressen außerhalb des Hauptspeichers)
EMSCRIPTEN_KEEPALIVE u32 pt_read32(u32 addr) { return _MMU_read32<ARMCPU_ARM9>(addr); }
EMSCRIPTEN_KEEPALIVE void pt_write8(u32 addr, u32 v) { _MMU_write08<ARMCPU_ARM9>(addr, (u8)v); }

EMSCRIPTEN_KEEPALIVE int pt_frameCount() { return (int)currFrameCounter; }

}
