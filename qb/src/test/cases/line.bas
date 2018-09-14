SCREEN 12

PSET (5,5), 1
REM graphics PSET 5 5 1
LINE -(1,2), 3
REM graphics LINE 5 5 1 2 3
LINE STEP(1,1)-STEP(2,0), 1
REM graphics LINE 2 3 4 3 1
COLOR 5
PSET (1,1)
REM graphics PSET 1 1
LINE (0,0)-(1,2)
REM graphics LINE 0 0 1 2
CIRCLE (1,2), 3, 4
REM graphics CIRCLE 1 2 3 4
CIRCLE (3,4), 9
REM graphics CIRCLE 3 4 9 NA
PAINT (3,4), 9
REM graphics PAINT 3 4 9 NA
PAINT (3,4), 1, 9
REM graphics PAINT 3 4 1 9
PAINT (3,4), , 9
REM graphics PAINT 3 4 NA 9