# DESMUME = Pfad zu https://github.com/44670/desmume-wasm (Stand 1015846) mit desmume-wasm-platin.patch
# ZLIB    = Pfad zu zlib 1.3.1
DESMUME ?= ../../desmume-wasm
ZLIB ?= ../../zlib
OUT ?= out/platin_emu.js
SRC := $(DESMUME)/desmume/src
OBJ ?= obj
CORE := $(shell cat srclist.txt) frontend/modules/Disassembler.cpp $(EXTRASRC)
ZSRC := adler32 compress crc32 deflate gzclose gzlib gzread gzwrite infback inffast inflate inftrees trees uncompr zutil
OBJS := $(patsubst %,$(OBJ)/%.o,$(CORE)) $(patsubst %,$(OBJ)/zlib/%.o,$(ZSRC)) $(OBJ)/platin_emu.o
OPT ?= -O3
CFLAGS := $(OPT) $(XCFLAGS) -DNDEBUG -DHAVE_LIBZ -DHOST_32 -I$(SRC) -I$(SRC)/libretro-common/include -I$(SRC)/frontend -I$(ZLIB) -Wno-everything -fno-strict-aliasing
CXXFLAGS := $(CFLAGS) -std=gnu++14

all: $(OUT)

$(OBJ)/%.cpp.o: $(SRC)/%.cpp
	@mkdir -p $(dir $@)
	@emcc $(CXXFLAGS) -c $< -o $@ && echo "OK $<" || (echo "FAIL $<"; false)
$(OBJ)/%.c.o: $(SRC)/%.c
	@mkdir -p $(dir $@)
	@emcc $(CFLAGS) -std=gnu11 -c $< -o $@ && echo "OK $<" || (echo "FAIL $<"; false)
$(OBJ)/zlib/%.o: $(ZLIB)/%.c
	@mkdir -p $(dir $@)
	@emcc $(OPT) -DZ_HAVE_UNISTD_H -c $< -o $@
$(OBJ)/platin_emu.o: platin_emu.cpp
	@emcc $(CXXFLAGS) -I$(SRC)/../wasm-port -c $< -o $@ && echo "OK main"

$(OUT): $(OBJS)
	@mkdir -p $(dir $@)
	emcc $(OPT) $(OBJS) -o $@ -s MODULARIZE=1 -s EXPORT_NAME=PlatinEmu -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=134217728 \
	  -s EXPORTED_RUNTIME_METHODS='["FS","HEAPU8","HEAP16","HEAPU32","cwrap","ccall"]' -s ENVIRONMENT=web,worker,node \
	  -s EXPORTED_FUNCTIONS='["_main","_malloc","_free","_pt_init","_pt_setSampleRate","_pt_romBuffer","_pt_setFirmware","_pt_loadRom","_pt_reset","_pt_runFrame","_pt_frame","_pt_audioBuf","_pt_audio","_pt_savSize","_pt_savPtr","_pt_savChanged","_pt_savFlush","_pt_stateSave","_pt_stateBuf","_pt_stateLoad","_pt_mainRam","_pt_mainRamMask","_pt_read32","_pt_write8","_pt_frameCount","_pt_importSave","_pt_exportSave"]' \
	  -s FILESYSTEM=1 -s EXIT_RUNTIME=0 -s ASSERTIONS=0 $(LINKEXTRA)
