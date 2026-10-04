# CHOMPI agent controller firmware.
#
#   make test     host tests (C++17 compiler from CXX, default g++)
#   make          ARM build: build/arm/04_AGENT.bin
#   make check    ARM build, then scripts/check-artifact.sh
#
# The ARM build needs GNU Arm Embedded Toolchain 10.3-2021.10, either on PATH
# or in ARM_GCC_BIN, and the pinned upstream sources from
# scripts/fetch-upstream.sh in .upstream/.

.DEFAULT_GOAL := firmware

ROOT_DIR     := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
FIXTURES     ?= $(abspath $(ROOT_DIR)/../../packages/chompi-protocol/fixtures/v1.json)
BUILD_DIR    := $(ROOT_DIR)/build
UPSTREAM_DIR ?= $(ROOT_DIR)/.upstream

CORE_SOURCES := $(wildcard $(ROOT_DIR)/src/core/*.cpp)

# ---------------------------------------------------------------------------
# Host tests
# ---------------------------------------------------------------------------

HOST_CXX      ?= $(CXX)
HOST_SANITIZE ?= -fsanitize=address,undefined -fno-sanitize-recover=all
HOST_CXXFLAGS ?= -std=c++17 -O1 -g -Wall -Wextra -Werror -Wshadow \
                 -Wconversion -Wno-sign-conversion
HOST_BUILD    := $(BUILD_DIR)/host
TEST_SOURCES  := $(wildcard $(ROOT_DIR)/test/*.cpp)
TEST_BIN      := $(HOST_BUILD)/controller-tests

$(TEST_BIN): $(CORE_SOURCES) $(TEST_SOURCES) $(wildcard $(ROOT_DIR)/src/core/*.h) \
             $(wildcard $(ROOT_DIR)/test/*.h)
	@mkdir -p $(HOST_BUILD)
	@echo "CXX $(notdir $@)"
	@$(HOST_CXX) $(HOST_CXXFLAGS) $(HOST_SANITIZE) -I$(ROOT_DIR)/src \
	    $(CORE_SOURCES) $(TEST_SOURCES) -o $@

.PHONY: test
test: $(TEST_BIN)
	@$(TEST_BIN) --fixtures $(FIXTURES)

# ---------------------------------------------------------------------------
# ARM firmware
# ---------------------------------------------------------------------------

ARM_GCC_BIN ?=
ifneq ($(strip $(ARM_GCC_BIN)),)
ARM_PREFIX := $(ARM_GCC_BIN)/arm-none-eabi-
else
ARM_PREFIX := arm-none-eabi-
endif
ARM_CC      := $(ARM_PREFIX)gcc
ARM_CXX     := $(ARM_PREFIX)g++
ARM_OBJCOPY := $(ARM_PREFIX)objcopy
ARM_SIZE    := $(ARM_PREFIX)size
ARM_NM      := $(ARM_PREFIX)nm
REQUIRED_GCC := 10.3-2021.10

CHOMPI_SHA   := a73d732613da684e4de844619b690776f0f50ccf
LAUNCHER_SHA := 79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415
LIBDAISY_DIR := $(UPSTREAM_DIR)/chompi/firmware/chompi-wave/code/libs/libDaisy
LAUNCHER_DIR := $(UPSTREAM_DIR)/launcher/firmware/chompi-launcher/code/src
# The launcher's app linker script carries the BACKUP_SRAM fix that puts
# libDaisy's boot_info at 0x38800000.
LDSCRIPT     := $(LAUNCHER_DIR)/chompi_sram.lds

ARM_BUILD := $(BUILD_DIR)/arm
TARGET    := 04_AGENT
ELF       := $(ARM_BUILD)/agent-controller.elf
BIN       := $(ARM_BUILD)/$(TARGET).bin
MAP       := $(ARM_BUILD)/agent-controller.map
MEMORY    := $(ARM_BUILD)/memory-usage.txt

FW_CPP_SOURCES := $(CORE_SOURCES) $(wildcard $(ROOT_DIR)/src/hw/*.cpp) \
                  $(ROOT_DIR)/src/main.cpp
FW_C_SOURCES   := $(LIBDAISY_DIR)/core/startup_stm32h750xx.c

MCU := -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard

# Same definitions as libDaisy's core/Makefile for APP_TYPE=BOOT_SRAM.
FW_DEFS := -DUSE_HAL_DRIVER -DSTM32H750xx -DHSE_VALUE=16000000 -DCORE_CM7 \
           -DSTM32H750IB -DARM_MATH_CM7 -DUSE_FULL_LL_DRIVER -DBOOT_APP

FW_INCLUDES := -I$(ROOT_DIR)/src \
    -I$(LIBDAISY_DIR) \
    -I$(LIBDAISY_DIR)/src \
    -I$(LIBDAISY_DIR)/src/sys \
    -I$(LIBDAISY_DIR)/src/usbd \
    -I$(LIBDAISY_DIR)/src/usbh \
    -I$(LIBDAISY_DIR)/Drivers/CMSIS/Include \
    -I$(LIBDAISY_DIR)/Drivers/CMSIS/DSP/Include \
    -I$(LIBDAISY_DIR)/Drivers/CMSIS/Device/ST/STM32H7xx/Include \
    -I$(LIBDAISY_DIR)/Drivers/STM32H7xx_HAL_Driver/Inc \
    -I$(LIBDAISY_DIR)/Middlewares/ST/STM32_USB_Device_Library/Core/Inc \
    -I$(LIBDAISY_DIR)/Middlewares/ST/STM32_USB_Host_Library/Core/Inc \
    -I$(LIBDAISY_DIR)/Middlewares/ST/STM32_USB_Host_Library/Class/MSC/Inc \
    -I$(LIBDAISY_DIR)/Middlewares/Third_Party/FatFs/src \
    -I$(LIBDAISY_DIR)/core

FW_COMMON := $(MCU) $(FW_DEFS) $(FW_INCLUDES) -O2 -g -Wall \
             -Wno-missing-attributes -fdata-sections -ffunction-sections \
             -include stm32h7xx.h
FW_CFLAGS   := $(FW_COMMON) -std=gnu11 -Wno-stringop-overflow
FW_CXXFLAGS := $(FW_COMMON) -std=gnu++17 -fno-exceptions -fno-rtti \
               -fno-unwind-tables -fshort-enums -finline-functions-called-once \
               -fno-move-loop-invariants -Wno-register -Wno-volatile
FW_LDFLAGS  := $(MCU) --specs=nano.specs --specs=nosys.specs -T$(LDSCRIPT) \
               -L$(LIBDAISY_DIR)/build -Wl,--gc-sections \
               -Wl,-Map=$(MAP),--cref -Wl,--print-memory-usage
FW_LIBS     := -ldaisy -lc -lm -lnosys

FW_OBJECTS := $(patsubst $(ROOT_DIR)/%.cpp,$(ARM_BUILD)/obj/%.o,$(FW_CPP_SOURCES)) \
              $(ARM_BUILD)/obj/startup_stm32h750xx.o

.PHONY: firmware toolchain-check upstream-check check clean

firmware: toolchain-check upstream-check $(BIN)

toolchain-check:
	@command -v $(ARM_CC) >/dev/null 2>&1 || { \
	    echo "error: $(ARM_CC) not found. Install GNU Arm Embedded Toolchain $(REQUIRED_GCC)"; \
	    echo "       and put its bin directory on PATH or pass ARM_GCC_BIN=<dir>."; exit 1; }
	@$(ARM_CC) --version | head -n 1 | grep -q '$(REQUIRED_GCC)' || { \
	    echo "error: $(ARM_CC) is not GNU Arm Embedded Toolchain $(REQUIRED_GCC):"; \
	    $(ARM_CC) --version | head -n 1; \
	    echo "       libDaisy and the CHOMPI firmwares are built with exactly that release."; exit 1; }

upstream-check:
	@test -f $(UPSTREAM_DIR)/VERIFIED \
	    && grep -qx 'chompi $(CHOMPI_SHA)' $(UPSTREAM_DIR)/VERIFIED \
	    && grep -qx 'launcher $(LAUNCHER_SHA)' $(UPSTREAM_DIR)/VERIFIED || { \
	    echo "error: pinned upstream sources missing or stale in $(UPSTREAM_DIR)."; \
	    echo "       Run scripts/fetch-upstream.sh first."; exit 1; }

$(FW_OBJECTS): | toolchain-check upstream-check

$(ARM_BUILD)/obj/%.o: $(ROOT_DIR)/%.cpp
	@mkdir -p $(dir $@)
	@echo "CXX $(patsubst $(ROOT_DIR)/%,%,$<)"
	@$(ARM_CXX) -c $(FW_CXXFLAGS) -MMD -MP $< -o $@

$(ARM_BUILD)/obj/startup_stm32h750xx.o: $(FW_C_SOURCES)
	@mkdir -p $(dir $@)
	@echo "CC  startup_stm32h750xx.c"
	@$(ARM_CC) -c $(FW_CFLAGS) -MMD -MP $< -o $@

$(ELF): $(FW_OBJECTS) $(LDSCRIPT)
	@echo "LD  $(notdir $@)"
	@$(ARM_CXX) $(FW_OBJECTS) $(FW_LDFLAGS) $(FW_LIBS) -o $@ > $(MEMORY)
	@$(ARM_SIZE) -A -x $@ >> $(MEMORY)
	@cat $(MEMORY)

$(BIN): $(ELF)
	@$(ARM_OBJCOPY) -O binary -S $< $@
	@echo "built $@ ($$(wc -c < $@) bytes)"

check: firmware
	@ARM_NM=$(ARM_NM) ARM_SIZE=$(ARM_SIZE) $(ROOT_DIR)/scripts/check-artifact.sh $(ELF) $(BIN)

clean:
	rm -rf $(BUILD_DIR)

-include $(wildcard $(ARM_BUILD)/obj/*.d $(ARM_BUILD)/obj/*/*.d $(ARM_BUILD)/obj/*/*/*.d)
