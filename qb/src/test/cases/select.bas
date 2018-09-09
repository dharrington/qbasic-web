SELECT CASE 5
  CASE 1
    PRINT "it's not 1"
  CASE 2
    PRINT "it's not 2"
  CASE 5
    PRINT "5"
  CASE 6:
    PRINT "it's not 6"
  CASE ELSE
    PRINT "ELSE"
END SELECT

X$ = "HI"

SELECT CASE X$
  CASE "HI"
    PRINT "first"
  CASE ELSE
    PRINT "first fail"
END SELECT

SELECT CASE X$
  CASE "OTHER"
  CASE "NOTHI", "HI"
    PRINT "second"
  CASE ELSE
    PRINT "second fail"
END SELECT

SELECT CASE X$
  CASE "OTHER"
  CASE "HI"
    Y$ = "last"
    PRINT Y$
END SELECT

SELECT CASE X$
  CASE "A" TO "G"
    PRINT "SHOULD NOT BE IN RANGE"
  CASE "H" TO "I"
    PRINT "IN RANGE"
END SELECT

SELECT CASE 5
  CASE IS < 10
    PRINT "5 is less than 10"
  CASE IS > 10
    PRINT "5 is greater than 10???"
END SELECT

REM output
5
first
second
last
IN RANGE
5 is less than 10