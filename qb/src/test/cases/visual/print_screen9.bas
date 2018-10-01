' Note, this output is NOT correct. Setting the background color should take place immediately,
' swapping the appearance of attribute 0. Handling modes with DAC appropriately will be more work...
' http://faq.qbasicnews.com/?blast=DacRegistersInScreenNine
REM compare_screenshot 0.0

SCREEN 9
COLOR 1,2
PRINT "Screen 9!"
FOR I = 1 TO 15
  COLOR I
  PRINT I
NEXT I