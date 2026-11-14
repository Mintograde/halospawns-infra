option(H1_NETWORK_REPLAY_FIXES "Build candidate Beta 8 network replay corrections" OFF)

function(hs_beta8_network_replay_source name input output)
    set(content "${${input}}")
    if(H1_NETWORK_REPLAY_FIXES)
        if(EMSCRIPTEN AND name STREQUAL "effect_evaluate_function_integral.c")
            hs_beta8_replace(content "float effect_evaluate_function_integral(int16_t function, float fraction)"
                "double effect_evaluate_function_integral(int16_t function, float fraction)")
            hs_beta8_replace(content "return (fraction * fraction);"
                "return ((double)fraction * (double)fraction);")
            hs_beta8_replace(content "return (((float)2.0 - fraction) * fraction);"
                "return ((2.0 - (double)fraction) * (double)fraction);")
            hs_beta8_replace(content "return ((-(((fraction * 2.0f) - 3.0f) * fraction)) * fraction);"
                "return ((double)(-(((fraction * 2.0f) - 3.0f) * fraction)) * (double)fraction);")
        elseif(EMSCRIPTEN AND name STREQUAL "effect_generate_particles.c")
            hs_beta8_replace(content "extern float effect_evaluate_function_integral(int16_t function, float fraction);"
                "extern double effect_evaluate_function_integral(int16_t function, float fraction);")
            hs_beta8_replace(content "(int)(effect_evaluate_function_integral(count_function, fraction) * count_float)"
                "(int)(float)(effect_evaluate_function_integral(count_function, fraction) * count_float)")
            hs_beta8_replace(content "(int)(effect_evaluate_function_integral(count_function, last_event_fraction) * count_float)"
                "(int)(float)(effect_evaluate_function_integral(count_function, last_event_fraction) * count_float)")
        endif()
    endif()
    set(${output} "${content}" PARENT_SCOPE)
endfunction()
