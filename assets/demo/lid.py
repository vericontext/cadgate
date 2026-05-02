import cadquery as cq

# Add a vent for the cooling fan.
result = (
    cq.Workplane("XY").box(60, 60, 4)
    .faces(">Z").workplane()
    .rect(10, 10).cutThruAll()
)
