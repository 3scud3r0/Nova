from nova_engine import Universe, arrow_snapshot
world = Universe(particles=4096, preset="particle-vm", enable_crossover=True)
world.step(10)
frame = world.snapshot()
positions = frame.positions  # read-only view, (N, 4), zero copy
arrow = arrow_snapshot(frame)  # Arrow owns NumPy owners, which pin the frame
print(positions.shape, arrow.schema)
del arrow, positions, frame  # release ALL views before stepping
world.step(10)
