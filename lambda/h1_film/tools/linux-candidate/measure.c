#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

int main(int count, char **arguments)
{
    if (count < 3) return 2;
    struct timespec started, finished;
    struct rusage usage;
    clock_gettime(CLOCK_MONOTONIC, &started);
    pid_t parent = getpid();
    pid_t child = fork();
    if (child < 0) return 2;
    if (!child) {
        if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != parent) _exit(127);
        execvp(arguments[2], arguments + 2);
        perror("execvp");
        _exit(127);
    }
    int status;
    while (wait4(child, &status, 0, &usage) < 0) {
        if (errno != EINTR) return 2;
    }
    clock_gettime(CLOCK_MONOTONIC, &finished);
    int result = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    FILE *output = fopen(arguments[1], "wx");
    if (!output) return 2;
    fprintf(output, "{\"exit_code\":%d,\"wall_seconds\":%.9f,\"user_seconds\":%.6f,\"system_seconds\":%.6f,\"max_rss_kib\":%ld}\n",
        result, finished.tv_sec - started.tv_sec + (finished.tv_nsec - started.tv_nsec) / 1e9,
        usage.ru_utime.tv_sec + usage.ru_utime.tv_usec / 1e6,
        usage.ru_stime.tv_sec + usage.ru_stime.tv_usec / 1e6, usage.ru_maxrss);
    if (fclose(output)) return 2;
    return result;
}
