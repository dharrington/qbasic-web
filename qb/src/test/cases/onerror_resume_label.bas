ON ERROR GOTO handler

DIM X(10)
PRINT "X(200):"; X(200)
nextline: PRINT "Resumed next!"
END

handler: 
PRINT "GOT ERROR, RESUME nextline"
RESUME nextline

REM output
X(200):GOT ERROR, RESUME nextline
Resumed next!