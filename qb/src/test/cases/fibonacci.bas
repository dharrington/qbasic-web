DECLARE SUB FIB(N#)

FOR I = 1 TO 10
  FIB result#, I
  PRINT result#
NEXT I

SUB FIB(R#,N#)
  IF N# <= 2 THEN 
    R# = 1
  ELSE
    FIB a#, N#-1
    FIB b#, N#-2
    R# = a# + b#
  END IF
END SUB

REM output
 1 
 1 
 2 
 3 
 5 
 8 
 13 
 21 
 34 
 55 