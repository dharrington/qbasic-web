DECLARE SUB PARTITION(V%(), s%, e%, m%)
DECLARE SUB QSORT(V%(), s%, e%)

' SUB QSORT(V%(), s%, e%)
'   len% = e% - s%
'   IF len% <= 1 THEN EXIT SUB
'   IF len% = 2 THEN
'     IF V%(s%) < V%(e%-1) THEN EXIT SUB
'     SWAP V%(s%), V%(e%-1)
'     EXIT SUB
'   END IF
'   m% = len% \ 2 + s%
'   PARTITION(V(), s%, e%, V%(m%))
' END SUB

DIM ARR(10) AS INTEGER
DATA 5, 3, 1, 7, 0, 2, 1, 6, 8, 9
FOR I = 0 TO 9
  READ ARR(I)
NEXT I

QSORT ARR(), 0, 10

FOR I = 0 TO 9
  PRINT STR(ARR(I));
NEXT I

SUB PARTITION(V%(), s%, e%, m%)
  mv% = V%(m%)
  SWAP V%(s%), V%(m%)
  es% = e%
  i% = s%+1
  WHILE i% < es%
    IF V%(i%) > mv% THEN
      DO
        es% = es% - 1
        IF es% <= i% THEN
          GOTO finish
        END IF
      LOOP UNTIL V%(es%) <= mv%
      SWAP V%(i%), V%(es%)
    END IF
    i% = i% + 1
  WEND
finish:
  SWAP V%(i%-1), V%(s%)
  m% = i% - 1
END SUB

SUB QSORT(V%(), s%, e%)
  len% = e% - s%
  IF len% <= 1 THEN EXIT SUB
  IF len% = 2 THEN
    IF V%(s%) < V%(e%-1) THEN EXIT SUB
    SWAP V%(s%), V%(e%-1)
    EXIT SUB
  END IF
  m% = len% \ 2 + s%
  PARTITION V%(), s%, e%, m%
  QSORT V%(), s%, m%-1
  QSORT V%(), m%+1, e%
END SUB

REM output