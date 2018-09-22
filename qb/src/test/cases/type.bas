DECLARE SUB PASSTOSUB (S AS snake)
DECLARE FUNCTION SOMEFUNC# (X)
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

X(3).head = SOMEFUNC#(123)
X(3).name = "fred"
X(3).pp.y = 987
PRINT X(3).head; X(3).name; X(3).pp.y
PASSTOSUB X()

SUB PASSTOSUB (S() AS snake)
  PRINT S(3).head; S(3).name; S(3).pp.y
END SUB

FUNCTION SOMEFUNC#(X) 
  SOMEFUNC = X*2
END FUNCTION

REM output
 246 fred 987 
 246 fred 987 
