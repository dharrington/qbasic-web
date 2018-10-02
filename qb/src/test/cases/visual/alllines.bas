' The line drawing isn't exactly the same as QB45, although I tried.
' Tweaking the constants in the line-drawing function, I was able to match lines perfectly
' for many orientations.
REM compare_screenshot 0.008

SCREEN 13
C = 1
FOR I = 0 TO 300 STEP 10
  CN = I / 5 - 30
  LINE (I, 0)-(150 + CN, 100 - 20), C
  C = C + 1
  LINE (I, 200)-(150 + CN, 100 + 20), C
NEXT I
FOR I = 0 TO 200 STEP 10
  CN = I / 5 - 20
  C = C + 1
  LINE (0, I)-(150 - 30, 100 + CN), C
  C = C + 1
  LINE (300, I)-(150 + 30, 100 + CN), C
  C = C + 1
NEXT I

