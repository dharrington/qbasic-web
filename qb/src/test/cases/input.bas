REM input This is a line of input
INPUT X$

REM input 123
INPUT "Integer", Y%

REM input 123.456
INPUT "Double", Z#
PRINT X$; Y%; Z#

REM input This is a line
LINE INPUT "Line: "; L$
PRINT L$

REM input This is another line
LINE INPUT ;"Line 2: "; L$
PRINT L$

REM input Last line
LINE INPUT L$
PRINT L$


REM output
? 
Integer
Double
This is a line of input 123  123.456 
Line: 
This is a line
Line 2: This is another line

Last line