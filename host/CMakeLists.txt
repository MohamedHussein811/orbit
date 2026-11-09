# Orbit host: the only code that names CEF. Built against the distribution pinned in
# engine/engine.json. Two variants share one wrapper library:
#   orbit       Release behaviour. Command-line switches are ignored and DevTools stays closed.
#   orbit_test  For the test suite. Needs ORBIT_USER_DATA_DIR and accepts test switches.

cmake_minimum_required(VERSION 3.21)

set_property(GLOBAL PROPERTY OS_FOLDERS ON)
project(orbit_host)

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../package.json" ORBIT_PACKAGE_JSON)
string(JSON ORBIT_VERSION GET "${ORBIT_PACKAGE_JSON}" version)
set(VERSION_SHORT "${ORBIT_VERSION}")
string(REPLACE "." ";" ORBIT_VERSION_PARTS "${ORBIT_VERSION}")
list(GET ORBIT_VERSION_PARTS 0 ORBIT_V1)
list(GET ORBIT_VERSION_PARTS 1 ORBIT_V2)
list(GET ORBIT_VERSION_PARTS 2 ORBIT_V3)

if(NOT CEF_ROOT)
  message(FATAL_ERROR "Set CEF_ROOT. tools/build-host.mjs does this for you.")
endif()
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)
PRINT_CEF_CONFIG()

set(ORBIT_COMMON_SRCS
  src/defaults.cc
  src/defaults.h
  src/host_api.cc
  src/host_api.h
  src/orbit_app.cc
  src/orbit_app.h
  src/orbit_client.cc
  src/orbit_client.h
  src/startup.cc
  src/startup.h
  )
set(ORBIT_SRCS_LINUX src/main_linux.cc)
set(ORBIT_SRCS_MAC src/main_mac.mm)
set(ORBIT_SRCS_WINDOWS src/main_win.cc)
set(ORBIT_SRCS ${ORBIT_COMMON_SRCS})
if(OS_LINUX)
  list(APPEND ORBIT_SRCS ${ORBIT_SRCS_LINUX})
elseif(OS_MAC)
  list(APPEND ORBIT_SRCS ${ORBIT_SRCS_MAC})
elseif(OS_WINDOWS)
  list(APPEND ORBIT_SRCS ${ORBIT_SRCS_WINDOWS})
endif()

set(ORBIT_HELPER_SRCS src/helper_mac.cc)
set(ORBIT_MAC_RESOURCES
  mac/English.lproj/InfoPlist.strings
  mac/English.lproj/MainMenu.xib
  )


if(OS_WINDOWS)
  enable_language(RC)
  add_executable(orbit_stamp tools/stamp_exe.cc)
  target_link_options(orbit_stamp PRIVATE /SUBSYSTEM:CONSOLE)
  add_library(orbit_resources OBJECT win/orbit.rc)
  target_compile_definitions(orbit_resources PRIVATE ORBIT_V1=${ORBIT_V1} ORBIT_V2=${ORBIT_V2} ORBIT_V3=${ORBIT_V3})
endif()

function(orbit_add_host target output_name is_test)
  set(CEF_TARGET "${target}")
  set(CEF_TARGET_OUT_DIR "${CMAKE_BINARY_DIR}/${target}")
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}")
  set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}")

  if(OS_LINUX)
    ADD_LOGICAL_TARGET("libcef_lib_${target}" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
    add_executable(${target} ${ORBIT_SRCS})
    SET_EXECUTABLE_TARGET_PROPERTIES(${target})
    add_dependencies(${target} libcef_dll_wrapper)
    target_link_libraries(${target} "libcef_lib_${target}" libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    set_target_properties(${target} PROPERTIES
      OUTPUT_NAME "${output_name}"
      INSTALL_RPATH "$ORIGIN"
      BUILD_WITH_INSTALL_RPATH TRUE
      RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}"
      )
    COPY_FILES("${target}" "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
    COPY_FILES("${target}" "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
    if(EXISTS "${CEF_BINARY_DIR}/libminigbm.so")
      COPY_FILES("${target}" "libminigbm.so" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
    endif()
    SET_LINUX_SUID_PERMISSIONS("${target}" "${CEF_TARGET_OUT_DIR}/chrome-sandbox")
  endif()

  if(OS_MAC)
    set(helper_target "${target}_Helper")
    set(helper_output "${output_name} Helper")
    set(app "${CEF_TARGET_OUT_DIR}/${output_name}.app")
    set(EXECUTABLE_NAME "${output_name}")
    set(PRODUCT_NAME "${output_name}")

    add_executable(${target} MACOSX_BUNDLE ${ORBIT_MAC_RESOURCES} ${ORBIT_SRCS})
    SET_EXECUTABLE_TARGET_PROPERTIES(${target})
    add_dependencies(${target} libcef_dll_wrapper)
    target_link_libraries(${target} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    set_target_properties(${target} PROPERTIES
      OUTPUT_NAME "${output_name}"
      MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/mac/Info.plist.in"
      RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}"
      )
    COPY_MAC_FRAMEWORK("${target}" "${CEF_BINARY_DIR}" "${app}")

    foreach(suffix_entry ${CEF_HELPER_APP_SUFFIXES})
      string(REPLACE ":" ";" suffix_entry ${suffix_entry})
      list(GET suffix_entry 0 name_suffix)
      list(GET suffix_entry 1 target_suffix)
      list(GET suffix_entry 2 plist_suffix)
      set(one_helper "${helper_target}${target_suffix}")
      set(one_output "${helper_output}${name_suffix}")

      set(plist "${CMAKE_CURRENT_BINARY_DIR}/${one_helper}-Info.plist")
      file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/helper-Info.plist.in" contents)
      string(REPLACE "\${EXECUTABLE_NAME}" "${one_output}" contents ${contents})
      string(REPLACE "\${PRODUCT_NAME}" "${one_output}" contents ${contents})
      string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${plist_suffix}" contents ${contents})
      file(WRITE ${plist} ${contents})

      add_executable(${one_helper} MACOSX_BUNDLE ${ORBIT_HELPER_SRCS})
      SET_EXECUTABLE_TARGET_PROPERTIES(${one_helper})
      add_dependencies(${one_helper} libcef_dll_wrapper)
      target_link_libraries(${one_helper} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
      set_target_properties(${one_helper} PROPERTIES
        MACOSX_BUNDLE_INFO_PLIST ${plist}
        OUTPUT_NAME "${one_output}"
        RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}"
        )
      add_dependencies(${target} "${one_helper}")
      add_custom_command(
        TARGET ${target}
        POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CEF_TARGET_OUT_DIR}/${one_output}.app"
                "${app}/Contents/Frameworks/${one_output}.app"
        VERBATIM
        )
    endforeach()

    COPY_MAC_RESOURCES("${ORBIT_MAC_RESOURCES}" "mac/" "${target}" "${CMAKE_CURRENT_SOURCE_DIR}" "${app}")
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/../branding/icons/orbit.icns" "${app}/Contents/Resources/orbit.icns"
      VERBATIM)
  endif()

  if(OS_WINDOWS)
    ADD_LOGICAL_TARGET("libcef_lib_${target}" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
    if(NOT USE_SANDBOX)
      message(FATAL_ERROR "Orbit must not be built without the sandbox.")
    endif()
    add_library(${target} SHARED ${ORBIT_SRCS})
    SET_LIBRARY_TARGET_PROPERTIES(${target})
    set_target_properties(${target} PROPERTIES
      OUTPUT_NAME "${output_name}"
      RUNTIME_OUTPUT_DIRECTORY "${CEF_TARGET_OUT_DIR}"
      )
    COPY_SINGLE_FILE(${target} ${CEF_BINARY_DIR}/bootstrap.exe ${CEF_TARGET_OUT_DIR}/${output_name}.exe)
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND orbit_stamp "${CEF_TARGET_OUT_DIR}/${output_name}.exe" "$<TARGET_OBJECTS:orbit_resources>"
      VERBATIM)
    add_dependencies(${target} libcef_dll_wrapper orbit_stamp orbit_resources)
    target_link_libraries(${target} "libcef_lib_${target}" libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    COPY_FILES("${target}" "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
    COPY_FILES("${target}" "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
    SET_LPAC_ACLS("${target}")
  endif()

  target_include_directories(${target} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
  if(is_test)
    target_compile_definitions(${target} PRIVATE ORBIT_TEST_BUILD=1)
  endif()
endfunction()

if(OS_MAC)
  orbit_add_host(orbit "Orbit" FALSE)
  orbit_add_host(orbit_test "OrbitTest" TRUE)
else()
  orbit_add_host(orbit "orbit" FALSE)
  orbit_add_host(orbit_test "orbit_test" TRUE)
endif()
