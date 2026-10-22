#ifndef NOVA_H
#define NOVA_H

#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct NovaHandle NovaHandle;

/**
 * Portable 64-byte C transfer record; native SoA storage has separate alignment.
 */
typedef struct NovaParticle {
  float pos_rad[4];
  float vel_mass[4];
  uint32_t phenotype[4];
  uint8_t genome_tape[16];
} NovaParticle;

#ifdef __cplusplus
extern "C" {
#endif // __cplusplus

/**
 * Creates an owned handle. preset: 0=canonical, 1=cosmic ink, 2=PVM, 3=liquid MPM.
 * # Safety
 * out must point to a writable handle slot. Free a successful result exactly once.
 */
int32_t nova_create(size_t count,
                    uint64_t seed,
                    uint32_t preset,
                    bool crossover,
                    struct NovaHandle **out);

/**
 * # Safety
 * handle must be live and exclusively owned for this call; no concurrent array reads.
 */
int32_t nova_step(struct NovaHandle *handle, size_t ticks);

/**
 * # Safety
 * handle must be live, exclusively owned and not previously freed. Null is allowed.
 */
void nova_destroy(struct NovaHandle *handle);

/**
 * Borrow float4 positions/radius. Pointer remains valid only until next mutation or destroy.
 * # Safety
 * handle must be live; data and count writable. Do not mutate or free returned memory.
 */
int32_t nova_positions(const struct NovaHandle *handle, const float **data, size_t *count);

/**
 * # Safety
 * Same lifetime and synchronization contract as nova_positions.
 */
int32_t nova_velocities(const struct NovaHandle *handle, const float **data, size_t *count);

/**
 * Inject a custom 64-byte particle record. The C struct need not be 64-byte aligned.
 * # Safety
 * handle exclusively live; particle points to 64 readable bytes in native C layout.
 */
int32_t nova_inject(struct NovaHandle *handle, const struct NovaParticle *particle);

/**
 * Returns required bytes including NUL. Copies at most capacity bytes of last thread-local error.
 * # Safety
 * If nonnull, destination must be writable for capacity bytes.
 */
size_t nova_last_error(char *destination, size_t capacity);

/**
 * Native upstream family: 0=hunar, 1=realethersim, 2=primordial-dish,
 * 3=par-particle-life, 4=fusion, 5=cellflow (independent implementation).
 * # Safety
 * out must be a writable handle slot; destroy a successful result exactly once.
 */
int32_t nova_create_fusion(size_t count, uint64_t seed, uint32_t family, struct NovaHandle **out);

/**
 * Enable signed-nibble recurrent organisms. Replaces genomes and resets neural memory.
 * # Safety
 * handle must be live and exclusively owned; all borrowed array views must be released.
 */
int32_t nova_enable_neural(struct NovaHandle *handle);

#ifdef __cplusplus
}  // extern "C"
#endif  // __cplusplus

#endif  /* NOVA_H */
