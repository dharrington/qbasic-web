REM compare_screenshot 0.0

SCREEN 13
' Paint lines of box
LINE (5, 5)-(25, 25), 1, B
PAINT (5, 5), 4, 0

' Paint inside
LINE (5, 50)-(50, 75)
LINE (5, 50)-(50, 100)
LINE (50, 75)-(100, 50)
LINE (50, 100)-(100, 50)
PAINT (15, 58), 4, 15

LINE (120, 5)-(140, 25), 8, B
PAINT (121, 6), 8, 8

