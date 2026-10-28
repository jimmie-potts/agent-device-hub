#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <netdb.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Test-only resolver: no DNS packet is sent for this synthetic hostname. */
int getaddrinfo(const char *node, const char *service,
                const struct addrinfo *hints, struct addrinfo **result) {
  if (node && strcmp(node, "stall.synthetic.invalid") == 0) {
    const char *marker = getenv("BUNNY_TEST_RESOLVER_MARKER");
    if (marker) {
      int file = open(marker, O_CREAT | O_WRONLY, 0600);
      if (file >= 0) {
        write(file, "entered", 7);
        close(file);
      }
    }
    sleep(12);
    return EAI_AGAIN;
  }
  int (*next)(const char *, const char *, const struct addrinfo *, struct addrinfo **) =
    dlsym(RTLD_NEXT, "getaddrinfo");
  return next(node, service, hints, result);
}
