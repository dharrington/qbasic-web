' This program matches QB45, but there appears to be a bug with QB45's line styling at some line angles
' which is not reproduced.
REM compare_screenshot 0.0

SCREEN 13
STYLE = 1
FOR I = 1 TO 16
 Y = 10 * I
 LINE (5, Y)-(100, Y), , , STYLE
 LINE (100 + Y, 5)-(100 + Y, 100), , , STYLE
 STYLE = STYLE * 2
NEXT I

