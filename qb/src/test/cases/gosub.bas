GOTO main

intro:
GOSUB preintro
PRINT "HI THERE"
RETURN 10
5 preintro: PRINT "PREINTRO"
RETURN

main:
X=5
GOSUB intro
10 PRINT X; "DONE"

REM output
PREINTRO
HI THERE
 5 DONE