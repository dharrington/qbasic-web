IF 1 THEN
  PRINT "0"
END IF

IF 1 THEN
  IF 1 THEN
    PRINT "1"
  END IF
END IF

IF -1 THEN
  PRINT "2"
END IF

IF 0 THEN
  PRINT "FAIL";
ELSE
  PRINT "3"
END IF

IF 0 THEN
  PRINT "FAIL2";
ELSEIF 1 THEN
  PRINT "4"
ELSE
  PRINT "FAIL3";
END IF

IF 0 THEN
  PRINT "FAIL4";
ELSEIF 0 THEN
  PRINT "FAIL5";
ELSE
  PRINT "5"
END IF

IF 1 THEN PRINT "6" ELSE PRINT "FAIL6"

REM output
0
1
2
3
4
5
6