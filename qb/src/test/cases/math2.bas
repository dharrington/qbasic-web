' Same as math.bas, but force the expressions to be evaluated at run-time.
X1=1
X2=2
X3=3
X5=5
X11=1.1
PRINT "1+2 ="; X1+2 
PRINT "2*3 ="; X2*3 
PRINT "1/2 ="; X1/2 
PRINT "1\2 ="; X1\2 
PRINT "3\2 ="; X3\2 
PRINT "5 MOD 3 ="; X5 MOD 3
PRINT "1=1 ="; X1=1
PRINT "1=2 ="; X1=2
PRINT "1>0 ="; X1>0
PRINT "1>1 ="; X1>1
PRINT "1.1>1 ="; X11>1
PRINT "1>=1 ="; X1>=1
PRINT "1.1>=1 ="; X11>=1
PRINT "2<3 ="; X2<3
PRINT "2<2 ="; X2<2
REM output
1+2 = 3 
2*3 = 6 
1/2 = .5 
1\2 = 0 
3\2 = 1 
5 MOD 3 = 2 
1=1 =-1 
1=2 = 0 
1>0 =-1 
1>1 = 0 
1.1>1 =-1 
1>=1 =-1 
1.1>=1 =-1 
2<3 =-1 
2<2 = 0 