DRAW "D60 R80 NU60 L80"
REM graphics DRAW kMove,4,60,,; kMove,2,80,,; kMove,0,60,,returnWhenDone; kMove,6,80,,
DRAW "NBE60 F80 BG60 H80"
REM graphics DRAW kMove,1,60,,nodrawreturnWhenDone; kMove,3,80,,; kMove,5,60,,nodraw; kMove,7,80,,
DRAW "M1,2"
REM graphics DRAW kMoveXY,1,2,,
DRAW "A1 M1,1"
REM graphics DRAW kRotation,1,,,; kMoveXY,1,1,,
DRAW "TA30 M1,1"
REM graphics DRAW kTurn,30,,,; kMoveXY,1,1,,
DRAW "C30"
REM graphics DRAW kColor,30,,,
DRAW "P30,50"
REM graphics DRAW kPaint,30,50,,