/* The recovered x86 translation units declare these CRT functions externally;
 * MSVC's C headers otherwise supply only their inline forms. */
extern double sqrt(double);
extern double fabs(double);
float sqrtf(float value) { return (float)sqrt((double)value); }
float fabsf(float value) { return (float)fabs((double)value); }
