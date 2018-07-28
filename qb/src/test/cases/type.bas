TYPE pos
  x AS INTEGER
  y AS INTEGER
  z AS INTEGER
END TYPE

TYPE snake
    head      AS INTEGER
    name      AS STRING
    pp        AS pos
END TYPE

DIM X(10) AS snake

X(3).head = 123
X(3).name = "fred"
X(3).pp.y = 987
PRINT X(3).head; X(3).name; X(3).pp.y
REM output
 123 fred 987 