find_program(H1_NODE NAMES node nodejs REQUIRED)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/prepare.mjs")
execute_process(COMMAND "${H1_NODE}" "${CMAKE_CURRENT_SOURCE_DIR}/prepare.mjs"
    "${H1_SOURCE}" "${CMAKE_CURRENT_BINARY_DIR}" "${H1_BETA3_PORT}" "${H1_SOURCE_COMMIT}" "${H1_SOURCE_DATE}"
    RESULT_VARIABLE prepare_result)
if(NOT prepare_result EQUAL 0)
    message(FATAL_ERROR "h1arena offline integration extraction failed")
endif()
