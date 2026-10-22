#include "nova.h"
#include <stdio.h>
int main(void) {
    NovaHandle *world = NULL;
    if (nova_create(4096, 42, 0, false, &world) != 0) return 1;
    if (nova_step(world, 10) != 0) { nova_destroy(world); return 2; }
    const float *positions = NULL; size_t count = 0;
    if (nova_positions(world, &positions, &count) == 0)
        printf("%zu particles; first x=%f\n", count, positions[0]);
    nova_destroy(world);
    return 0;
}
