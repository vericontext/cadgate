import cadquery as cq

# 20×20×20 outer box, hollowed out to a 0.5mm wall — violates min-wall-thickness.
result = cq.Workplane("XY").box(20, 20, 20).faces(">Z").shell(-0.5)
