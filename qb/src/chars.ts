// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Buffer, ICharmap } from "./screen";

enum CharmapName {
    k8x8,
    k8x16,
    k8x14,
}

const charmapData: string[] = [
    // 8x8
    `/4GBk+/H7/8A/wDww8CA53/955mAwf/n5+f/////////z5OTz//Hn+ef///////5g8+Hh+MDxwOH
    h///5/+fh/9+AAHHg+//AMM8+JnMnCQf8cOZJJz/w8Pn58//2+cA/4eTk4M5k5/Pz5nP////8zmP
    MzPDP58zMzPPz8//zzP/WiQBg8fH5xiZZvCZwIDDB8GBmSTH/4GB5/OfP5nDAP+HkwE/M8c/n+fD
    z////+cxz/Pzkwc/8zMzz8+fA+fz/34AAQEBg8M8vUKCmc+cGAEB55mEk//n5+cBAT8AgYH/z/+T
    h+eJ/5/nAAP/A//PIc/HxzPzB+eHg///P//z5/9CPIODAQHDPL1CM8PPnBgHweeZ5JOBgeeB858/
    mQDD/8//AfPPI/+f58PP////nwnPn/MB8zPPM/P//5//58//ZhjHxymD5xiZZjPnj5jDH/GB/+TH
    gcPnw+fPAdsA5////5MHmTP/z8+Zz8//zz8ZzzMz8zMzzzPnz8/PA8///34A7+/v7/8AwzwzgQ8Z
    JH/9w5nkM4Hn5+f/////////z/+TzzmJ/+ef///P/89/gwMDh+GHh8+Hj8/P5/+fz/+Bgf//x8f/
    AP8Ah+cfP+f//+f//4f/AP//////////////////////////n///////////////////n/////+D
    zwPDBwEBwzOH4RkPOTnHA4cDhwMzMzk5MwGHP4fv/8//H//j/8f/H8/zH4//////////7///////
    /+PnH4n/OYeZmZOdnZkzz/OZnxEZk5kzmTNLMzM5OTM5n5/nx//P/5//8/+T/5///5/P////////
    /8/////////P588j7yEzmT+Zl5c/M8/zk58BCTmZM5mfzzMzOZMzc5/P55P/54efh/OHn4mTj/OZ
    zzMHhyOJI4ODMzM5OTMDz+fP/8chM4M/mYeHPwPP84efASE5gzODz88zMynHh+ef5+c5///zgzOD
    Mw8zic/zk88BMzOZM4k/zzMzKZMzZx//4/+TIQOZP5mXlzEzzzOTnSkxOZ8jk+fPMzMBx8/Nn/Pn
    ////g5k/MwOfM5nP84fPATMzmTOZh88zMwHHM8/P58//OT8zmZmTnZ+ZM88zmZk5OZOfh5kzzzOH
    EZPPmZ/55////zOZMzM/n4OZzzOTzykzM4ODn/PLM4cBk4Obz+fP/zmHMwPDBwEPwTOHhxkBOTnH
    D+MZh4cDzzk5hwGH/Yf///+JI4eJhw/zGYczGYc5M4ef8w8H54nPkznzA+PnH/8B////////////
    /////////////////////////////wD/////////B///h///////D+H/////////B////////4f/
    44EzH8//gTMfM4MfOc/j/8GH//+H//88M+fHMwfx48f///8Dw8fP//88POf//92qJOfn58n//8nJ
    /8nJ5/8zM/88///P/zz///85/8fP//+TMzMfMx8z5//nkzMz5P//4+MH/5OT////OTnnzDN3VYjn
    5+fJ///Jyf/Jyef/P/+Hw4eHh4fDh4ePx4+T/wOAM////////8MzgZuHM+eHj////zOTk8///zMz
    /5mZ3aok5+cHyf8HCckBCckH/zMzM/nz8/M/mTMzz+fPOYef8wGHh4czMzOZMz8PAwXD88+HMwcT
    wcefAwMhJOczzHdVEefn58n/5/nJ+fnJ5/+HMwPBg4ODP4EDA8/nzwEzh4AzMzMzMzMzmTM/n885
    54PPMzMzA///Pz/zzMjnmZndqiTnBwcJAQcJyQkBAQcH5zM/mTMzM4efPz/P5885A58zMzMzMzMz
    g8MzgRkDMOczzzMzMyOBgzM/85mQ58wzd1WI5+fnycnnycnJ////5/OBh8CBgYHzw4eHh8OHOTMD
    gDGHh4eBgfPnh+cDzzkngYeHgTMz//+H//8zMOf//92qJOfn58nJ58nJyf///+eH////////x///
    //////////////////8H///n/884j///////////////8Pz///93VRHn5+fJyefJycn////n5+f/
    5//n58nJ/8n/yf/J58n//8nn///J5+f/AP8P8AD/////A////wPHx+P/+ceH/8+f5/Hnz//H///w
    h4///+fn/+f/5+fJyf/J/8n/yefJ///J5///yefn/wD/D/AA/4cDATP/mYnPk5PP//OfMwPPz8/k
    58+Jk///85Pn///n5//n/+fgycjACADIAAgAyQD/yeDg/8kA5/8A/w/wAIkzM5OfgZkjhzk554GB
    PzP/A+ef5Of/I5P///OTz8P/5+f/5//n58nPz///z////8n//8nn5//J5+f/AP8P8AAjBz+TzyeZ
    5zMBOYMkJAczA8/Pz+fnA//H5//zk5/D/+AAAOAAAODIwMgACMgACAAAAADA4ODAAAAH4AAAD/D/
    NzM/k58nmeczOZMzJCQ/M//Pn+fn5/+J/+fnE5OHw////+fn/+fnyf/J/8nJ/8n//+fJ///nycnn
    /+cAAA/w/yMHP5MzJ4Pnh5OTM4GBnzMD////5yfPI////5P//8P////n5//n58n/yf/Jyf/J///n
    yf//58nJ5//nAAAP8P+JPz+TA4+f58/HEYf/n8cz/wMDA+cnz//////D////////5+f/5+fJ/8n/
    ycn/yf//58n//+fJyef/5wAAD/D//z//////P/8D/////z/////////nj///////4/////8=`,
    // 8x16
    `//////////8A/wD/////////////////////////////////5///////////////////////////
    ////////////////////AP8A//////9//f///4P///////////////+Z/+f//8//////////////
    ////////////////////gYH//////wD/AOHDwID/P/nnmYA5/+fn5//////////nmf+D/8fP88//
    ///////H54OD8wHHAYOD//////+D/34A///n5/8A/wDxmcyc5x/xw5kkn//Dw+f/////////w5mT
    Of+Tz+fn////////k8c5OeM/nzk5Of//+f+fOf9aJJPvw8P/AP8A5ZnAgOcP4YGZJMf/gYHn////
    /+8B/8Pbkz09k5/P8////////TmH+fnDPz/5OTnn5/P/zzn/fgABx8OB/wDDPM2Zz5wkB8HnmSST
    /+fn5+fP/9fHAf/D/wE/Ocf/z/OZ5/////k55/P5kz8/+Tk55+fngefz/34AAYMYAOcYmWaHmc+c
    wwEB55mEOf/n5+fznz+Tx4P/5/+Tg/OJ/8/zw+f////zKefnwzMDA/ODgf//z//z5/9CPAEBGADD
    PL1CM8PPnBgHweeZ5Dn/5+fnAQE/AYOD/+f/k/nnI//P8wCB/wH/5ynnz/kB+TnnOfn//5//+ef/
    ZhgBgxiBwzy9QjPnz5zDD+GBmeSTAYHn5/OfP5ODx//n/5P5zzP/z/PD5////88555/58/k5zzn5
    ///PgfPn/34Ag8fn5+cYmWYzgY+YJB/xw//kxwHD54HnzwHXAcf///8BeZ8z/8/zmefn//+fOec/
    +fP5Oc85+efn5//n//9+AMfv5+f/AMM8M+cPGOc/+eeZ5PMB5+fD/////wHv/+f/kzk5M//n5///
    5//nP5PnOTnzOTnPOfPn5/P/z+f/gYHv/8PD/wD/AIfnHxnnf/3/meQ5AYHn5//////////n/5OD
    eYn/88///+f/53/HgQGD4YODz4OH/8/5/5/n//////////8A/wD///8/////////g///////////
    ////////5//////////P////////////////////////////////////AP8A////////////////
    /////////////////+f//////////////////////////////////////////////wD/AP//////
    //////////////////////////////////////////////////////////////////////////8A
    /wD/////////////////////////////////////////////////////////////////////////
    /////////////////////////////////////+//z///////////////////////////////////
    ///////////////////////////////////////////////H/8//////////////////////////
    /////////////////+8DwwcBAcM5w+EZDzk5gwODA4OBOTk5OZkBw//Dk//n/x//4//H/x/n+R/H
    /////////+/////////x54+J/4PHmZmTmZmZOefzmZ8RGTmZOZk5gTk5OTmZOc9/8zn///+f//P/
    k/+f5/mf5//////////P////////5+fnI/85k5k9mZ2dPTnn85mfAQk5mTmZOaU5OTmTmXnPP/P/
    ////n//z/5v/n///n+f/////////z////////+fn5//vOTmZP5mXlz855/OTnwEBOZk5mZ/nOTk5
    g5nzzx/z////h4eDw4OfiZPH8ZnnEyODI4kjgwMzmTk5OQHn5+f/xyE5gz+Zh4c/Aefzh58pITmD
    OYPH5zk5KcfD58+P8/////OTOZM5DzOJ5/mT5wGZOZkziTnPM5k5kzkzj//x/5MhAZk/mZeXITnn
    84efOTE5nzmT8+c5OSnH58/Px/P///+DmT8zAZ8zmef5h+cpmTmZM5mfzzOZKcc55+fn5/85ITmZ
    P5mfnzk55zOTnzk5OZ85mfnnOTkpg+efz+Pz////M5k/Mz+fM5nn+YfnKZk5mTOfx88zmSnHOc/n
    5+f/OSM5mT2ZnZ85OeczmZ05OTmfKZk55zmTAZPnPc/x8////zOZPzM/nzOZ5/mT5ymZOZkzn/PP
    M5kpxzmf5+fn/zk/OZmZk5mfmTnnM5mZOTk5nyGZOec5xxE55znP+fP///8zmTkzOZ8zmef5mecp
    mTmZM585yTPDAZM5Oefn5/8BgzkDwwcBD8U5w4cZATk5gw+DGYPDg++TOcMBw/3D////iYODiYMP
    gxnD+RnDOZmDg4MPg+OJ55M5gQHx54//////////////////////////8///////////////////
    //////////P//5n//////5/z//////////n///////////////////////////////H/////////
    ////////AP////////8z//+Z//////+f8//////////z////////////////////////////////
    ////////////////////////////h///w///////D+H/////////B///////////////////////
    ////////////////////////////////////////////////////////////////////////////
    ///////////////H5///////////////////////////if/////////////uqiLn5+fJ///Jyf/J
    yef////z7/+fx//v/5//5585k8///+//n8+f/zk558f/B/Hn8+fn/yPDx////z8/////u1WI5+fn
    yf//ycn/ycnn/8Mz58czz5P/xznPmcPP/8ef/8HHOc+Hzzn//+eTmTPkz+fPz4n/k5PP//8/P+f/
    /+6qIufn58n//8nJ/8nJ5/+Z/8+T/+fH/5P/5/+Z5+////+Tk//nM+f/gznDm5kz55/Pn58jOZOT
    z///PT3n//+7VYjn5+fJ///Jyf/Jyef/Pf///////8P////////HxwH/M////////zk5mZ/DB+f/
    /////xnBx////zk5////7qoi5+fnyf//ycn/ycnn/z8zg4eHh4eZg4ODx8fHk5OZMzODg4MzMzk5
    OZ8P5zvnh8eDMyMJ///P//8zM+fJJ7tViOfnB8n/BwnJAQnJB/8/Mznz8/Pznzk5Oefn5zk5n4kB
    OTk5MzM5OTmfn4EzgfPnOTOZAYGDzwEB5+fnk5PuqiLn5+fJ/+f5yfn5yef/PzMBg4ODg58BAQHn
    5+c5OYPJMzk5OTMzOTk5n5/nIeeD5zkzmSH//58/+c/P5yfJu1WI5wcHCQEHCckJAQEHBz0zPzMz
    MzOZPz8/5+fnAQGfgTM5OTkzMzk5OZmfgTPnM+c5M5kx//8/P/mfmcOTk+6qIufn58nJ58nJyf//
    /+eZMz8zMzMzwz8/P+fn5zk5nyczOTk5MzM5OTnDn+cz5zPnOTOZOf//OT/5IzHDySe7VYjn5+fJ
    yefJycn////nwzM5MzMzM/M5OTnn5+c5OZknMzk5OTMzOTk55xnnM+cz5zkzmTn//zk/+Xlhw///
    7qoi5+fnycnnycnJ////5/OJg4mJiYn5g4ODw8PDOTkBkTGDg4OJiYGDg+cD5znnicODiZk5//+D
    ///zwef//7tViOfn58nJ58nJyf///+f5////////w//////////////////////5////////J///
    ////////////5/n////uqiLn5+fJyefJycn////ng///////////////////////////////8///
    /////4///////////////8H5////u1WI5+fnycnnycnJ////5///////////////////////////
    /////4f//////////////////////////////+6qIufn58nJ58nJyf///+f/////////////////
    //////////////////////////////////////////////+7VYjn5+fJyefJycn////n5+f/5//n
    58nJ/8n/yf/J58n//8nn///J5+f/AP8P8AD////////////////////////////n////////////
    /+fn/+f/5+fJyf/J/8n/yefJ///J5///yefn/wD/D/AA////////////////////////////5///
    x///8CeP///n5//n/+fnycn/yf/J/8nnyf//yef//8nn5/8A/w/wAP+HAf/////////H4f//4///
    ////8ef//5P///OTJ///5+f/5//n58nJ/8n/yf/J58n//8nn///J5+f/AP8P8AD/Mzn/Af///4HH
    k8///M+D///P8+Tn//+T///zk8///+fn/+f/5+fJyf/J/8n/yefJ///J5///yefn/wD/D/AA/zM5
    ATn/mYnnkznn//mfOQHn5+fk5+f/x///85Ofg//n5//n/+fgycjACADIAAgAyQD/yeDg/8kA5/8A
    /w/wAIkzP5OfgZkjwzk584GBnzn/5/PP5+fnif////OTN4P/5+f/5//n58nPz///z////8n//8nn
    5//J5+f/AP8P8AAjJz+TzyeZ55k5OcEkJIM5/4H5n+fn/yP////zkweD/+AAAOAAAODIwMgACMgA
    CAAAAADA4ODAAAAH4AAAD/D/JzM/k+cnmeeZAZOZJCSfOQHn88/n54H//+f/E///g////+fn/+fn
    yf/J/8nJ/8n//+fJ///nycnn/+cAAA/w/yc5P5PPJ5nnmTmTmSQMnzn/5+fn5yf/if/n55P//4P/
    ///n5//n58n/yf/Jyf/J///nyf//58nJ5//nAAAP8P8nOT+TnyeD58M5k5mBgZ85///P8+cn5yP/
    //+T//+D////5+f/5+fJ/8n/ycn/yf//58n//+fJyef/5wAAD/D/Izk/kzknn+fnk5OZ/5/POQH/
    ///nJ+f/////w///g////+fn/+fnyf/J/8nJ/8n//+fJ///nycnn/+cAAA/w/4kzP5MBj5/ngccR
    w/8/4zn/AIGB54///////+P////////n5//n58n/yf/Jyf/J///nyf//58nJ5//nAAAP8P//////
    //8//////////////////+f/////////////////5+f/5+fJ/8n/ycn/yf//58n//+fJyef/5wAA
    D/D////////////////////////////n/////////////////+fn/+fnyf/J/8nJ/8n//+fJ///n
    ycnn/+cAAA/w////////////////////////////5//////////////////n5//n58n/yf/Jyf/J
    ///nyf//58nJ5//nAAAP8P///////////////////////////+f//////////////w==`,
    // 8x14
    `//////////8A/wD/////////////////////////////////5///////////////////////////
    ////////////////////AP8A/////////////4P///////////////+Z/+f//8//////////////
    ////////////////////gYH//+fn/wD/AOHDwIDnf/3nmYA5/+fn5//////////nmZOD/8fP88//
    //////2D54OD8wHHAYOD///5/5+D/34Ak+/Dw/8A/wDxmcyc5z/5w5kkn//Dw+f/////7wH/w5mT
    Of+Tz+fn///////5Occ5OeM/nzk5Oefn8//POf9aJAHHw4H/AMM85ZnAgCQf8YGZJMf/gYHn58//
    18cB/8PbAT09k5/P85nn////8zGH+fnDPz/5OTnn5+f/5zn/fgABgxgA5xiZZs2Zz5zDB8HnmSST
    /+fn5/OfP5PHg//D/5M/Ocf/z/PD5////+ch5/P5kz8/8zk5///PgfPz/34AAQEYAMM8vUKHw8+c
    GAEB55mEOf/n5+cBAT8Bg4P/5/+Tg/OJ/8/zAIH/Af/PCefnwzMDA+eDgf//n//55/9CPAGDGIHD
    PL1CM+fPnMMHweeZ5Dn/5+fn858/k4PH/+f/k/nnI//P88Pn////nxnnz/kB+TnPOfn//8//8+f/
    ZhiDx+fn5xiZZjOBj5gkH/GB/+STAYHngefPAdcBx////wF5zzP/z/OZ5+f//z8555/58/k5zzn5
    5+fngef//34Ax+/n5/8Awzwz5w8Y5z/5w5nkxwHD58P/////Ae//5/+TOZkz/+fn///n/+d/Oec5
    OfM5Oc858+fn8//P5/+Bge//w8P/AP8Ah+cfGed//eeZ5PMB5+fn/////////+f/k4M5if/zz///
    5//n/4OBAYPhg4PPg4f/z/n/n+f//////////wD/AP///z////////85/4H////////////////n
    /////////8////////////////////////////////////8A/wD/////////////g///////////
    ////////5///////////////////////////////////////////////AP8A////////////////
    ////////////////////////////////////////////////////////////////////////////
    ///////////////////v/8//////////////////////////////////////////////////////
    ////////////////////////////x//P/////////////////////////////////////////4Pv
    A8MHAQHDOcPhGQ85OccDgwODgTk5OTmZAcN/w5P/5/8f/+P/x/8f5/kfx//////////v////////
    8eePif85x5mZk5mZmTnn85mfERmTmTmZOYE5OTk5mTnPP/M5////n//z/5P/n+f5n+f/////////
    z////////+fn5yP/OZOZPZmdnT055/OTnwEJOZk5mTmlOTk5k5lzzx/z/////5//8/+b/5///5/n
    /////////8/////////n5+f/7yE5mT+Zl5c/Oefzk58BATmZOZmf5zk5OceZ58+P8////4eHg8OD
    n4mTx/GZ5xMjgyOJI4MDM5k5OTkB5+fn/8chOYM/mYeHPwHn84efKSE5gzmDx+c5OSnHw8/Px/P/
    ///zkzmTOQ8zief5k+cBmTmZM4k5zzOZOZM5M4//8f+TIQGZP5mXlyE55/OTnzkxOZ8pk/PnOTkp
    x+efz+Pz////g5k/MwGfM5nn+YfnKZk5mTOZj88zmSnHOefn5+f/OSM5mT2ZnZ85Oeczk505OTmf
    IZk55zmTAZPnPc/x8////zOZPzM/nzOZ5/mT5ymZOZkzn+PPM5kpxznP5+fn/zk/OZmZk5mfmTnn
    M5mZOTmTn4OZOec5x4M55znP+fP///8zmTkzOZ+Dmef5mecpmTmDg585yTPDAZOBmefn5/8BgzkD
    wwcBD8U5w4cZATk5xw/zGYPDg++TOcMBw/3D////iYODiYMP8xnDmRnDOZmDn/MPg+OJ55M5+QHx
    54//////////////////////////8f///////////////////////////zP//5n//////5/z////
    //////P/////////////////////////////////////////////////AP////////+H///D////
    //8P4f////////8H////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////8fn////////////////////
    //////+J/////////////+6qIufn58n//8nJ/8nJ5/////Pv/5/H/+//n//nnzmTz///7/+fz5//
    OTnnx/8H8efz5+f/I8PH////Pz////+7VYjn5+fJ///Jyf/Jyef/wzPnxzPPk//HM8+Zw885x5//
    wcc5z4fPOTk555OZM+TP58/Pif+Tk8///z8/5///7qoi5+fnyf//ycn/ycnn/5kzz5Mz58f/kzPn
    mZnn7////5OTOecz5znH/8ObmTPnn8+fnyM5k5PP//85Oef//7tViOfn58n//8nJ/8nJ5/89////
    ////w////////8fHATMz////////kzmZn8MH5///////GcHH////MzP/ySfuqiLn5+fJ///Jyf/J
    yef/PzODh4eHh5mDg4PHx8eTk5mJM4ODgzMzOTk5nw/nO+eHx4MzIwn//8///ycn55OTu1WI5+cH
    yf8HCckBCckH/z8zOfPz8/OfOTk55+fnOTmfyQE5OTkzMzk5OZ+fgTOB8+c5M5kBgYPPAQHPz+cn
    ye6qIufn58n/5/nJ+fnJ5/89MwGDg4ODmQEBAefn5zk5g4EzOTk5MzM5OTmZn+ch54PnOTOZIf//
    nz/5n5nDk5O7VYjnBwcJAQcJyQkBAQcHmTM/MzMzM8M/Pz/n5+cBAZ8nMzk5OTMzOTk5w5+BM+cz
    5zkzmTH//zk/+SMxw8kn7qoi5+fnycnnycnJ////58MzOTMzMzPzOTk55+fnOTmZJzM5OTkzM4GT
    OecZ5zPnM+c5M5k5//85P/l5YcP//7tViOfn58nJ58nJyf///+fziYOJiYmJ+YODg8PDwzk5AZEx
    g4ODiYn5x4PnA+c554nDg4mZOf//g///88Hn///uqiLn5+fJyefJycn////n+f///////8P/////
    ////////////////8////////yf//////////////+f5////u1WI5+fnycnnycnJ////54P/////
    /////////////////////////4f///////+P///////////////B+f///+6qIufn58nJ58nJyf//
    /+f///////////////////////////////////////////////////////////////+7VYjn5+fJ
    yefJycn////n5+f/5//n58nJ/8n/yf/J58n//8nn///J5+f/AP8P8AD/////////////////////
    ///////n/////////////+fn/+f/5+fJyf/J/8n/yefJ///J5///yefn/wD/D/AA////////////
    ////////////////5///x///8CeP///n5//n/+fnycn/yf/J/8nnyf//yef//8nn5/8A/w/wAP//
    Af8B////gcfH4f/84////8/z8ef//5P///OTJ///5+f/5//n58nJ/8n/yf/J58n//8nn///J5+f/
    AP8P8AD//zn/Of///+eTk8//+c+DAefn5+Tn5/+T///zk8///+fn/+f/5+fJyf/J/8n/yefJ///J
    5///yefn/wD/D/AA/4M5AZ//mYnDOTnn/4GfOf/n88/k5+eJx///85Ofg//n5//n/+fgycjACADI
    AAgAyQD/yeDg/8kA5/8A/w/wAIk5P5PPgZkjmTk584Eknzn/gfmf5+f/I/////OTN4P/5+f/5//n
    58nPz///z////8n//8nn5//J5+f/AP8P8AAjAz+T5yeZ55kBOcEkJIM5Aefzz+fngf//5//zkweD
    /+AAAOAAAODIwMgACMgACAAAAADA4ODAAAAH4AAAD/D/Jzk/k88nmeeZOZOZJAyfOf/n5+fn5/+J
    /+fnE///g////+fn/+fnyf/J/8nJ/8n//+fJ///nycnn/+cAAA/w/yc5P5OfJ4PnwzmTmYGBnzn/
    /8/z5yfnI////5P//4P////n5//n58n/yf/Jyf/J///nyf//58nJ5//nAAAP8P8jAz+TOSef5+eT
    k5n/n885Af///+cn5//////D//+D////5+f/5+fJ/8n/ycn/yf//58n//+fJyef/5wAAD/D/iT8/
    kwGPn+eBxxHD/z/jOf8AgYHnj///////4////////+fn/+fnyf/J/8nJ/8n//+fJ///nycnn/+cA
    AA/w//8//////z//////////////////5//////////////////n5//n58n/yf/Jyf/J///nyf//
    58nJ5//nAAAP8P//v////////////////////////+f/////////////////5+f/5+fJ/8n/ycn/
    yf//58n//+fJyef/5wAAD/D////////////////////////////n//////////////8=`,
];

class CharMap implements ICharmap {
    constructor(public width: number, public height: number, private data_: Buffer) { }
    data() { return this.data_; }
    charOffset(code: number): number[] {
        // Images have 4 rows of 64 characters each.
        return [this.width * (code % 64), this.height * Math.floor(code / 64)];
    }
}

function newCharmap(name: CharmapName) {
    // charmaps are stored as 1-bit per pixel, base64.
    // Expand to a 1 byte per pixel Buffer.
    const pc = atob(charmapData[name]);
    let charHeight: number = 0;
    switch (name) {
        case CharmapName.k8x8:
            charHeight = 8;
            break;
        case CharmapName.k8x16:
            charHeight = 16;
            break;
        case CharmapName.k8x14:
            charHeight = 14;
            break;
    }
    const buf = new Buffer(512, charHeight * 4);

    for (let i = 0; i < pc.length; i++) {
        const byte = pc.charCodeAt(i);
        let offset = i * 8;
        for (let bit = 128; bit != 0; bit = bit >> 1) {
            buf.data[offset] = (byte & bit) ? 0 : 255;
            offset++;
        }
    }
    return new CharMap(8, charHeight, buf);
}

export function get8x16(): ICharmap { return newCharmap(CharmapName.k8x16); }
export function get8x8(): ICharmap { return newCharmap(CharmapName.k8x8); }
export function get8x14(): ICharmap { return newCharmap(CharmapName.k8x14); }
