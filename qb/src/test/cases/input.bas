REM input This is a line of input
INPUT X$
REM input 123
REM input 123.456
INPUT "Integer", Y%
INPUT "Double", Z#
PRINT X$; Y%; Z#

REM input This is a line
REM input This is another line
REM input Last line
LINE INPUT "Line: "; L$
PRINT L$
LINE INPUT ;"Line 2: "; L$
PRINT L$
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