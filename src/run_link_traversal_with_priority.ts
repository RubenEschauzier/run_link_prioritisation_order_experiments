import * as fs from 'fs';
import * as _ from 'lodash';
//https://hyperjs.herokuapp.com/

class runExperiments{
    public engine: any;
    public queryEngineFactory: any;

    public possibleSources: string[];
    public indexLinkSourceMap: Map<number,string>; 
    public indexArray: number[];
    public bestFirstResult: number;
    public bestFirstResultProgression: number[];

    public readonly nExecutions: number;
    public progressBar: any;
    public constructor(nExecutions: number){
        this.queryEngineFactory = require("@comunica/query-sparql-link-traversal-solid-benchmark-version").QueryEngineFactory;

        this.possibleSources = [  
        "typeIndex", 
        "http://www.w3.org/ns/ldp#contains",
        "http://www.w3.org/ns/pim/space#storage", 
        "cMatch", 
        "http://www.w3.org/2000/01/rdf-schema#seeAlso",
        "http://www.w3.org/2002/07/owl##sameAs",
        "http://xmlns.com/foaf/0.1/isPrimaryTopicOf"
        ];

        this.indexLinkSourceMap = new Map<number, string>();
        this.possibleSources.map((x: string, i) => this.indexLinkSourceMap.set(i, x)); 
        this.indexArray = [...Array(this.possibleSources.length).keys()];
        this.bestFirstResult = Infinity;
        this.bestFirstResultProgression = [];

        this.nExecutions = nExecutions
    }

    public getMeanArray(input: number[]){
        return input.reduce((acc, cV) => acc + cV, 0) / input.length;
    }

    public getStdArray(input: number[]){
        const mean = this.getMeanArray(input);
        return Math.sqrt(input.reduce((acc, cV) => acc + Math.pow(cV - mean, 2), 0) / (input.length - 1));

    }

    public static factorial(n: number){
        let fact = n;
        for (let i = 1; i<n ; i++){
            fact = fact * (n-i);
        }
        return fact;
    }

    public * permute(permutation: number[]) {
        let length = permutation.length,
            c = Array(length).fill(0),
            i = 1, k, p;

        yield permutation.slice();

        while (i < length) {
            if (c[i] < i) {
            k = i % 2 && c[i];
            p = permutation[i];
            permutation[i] = permutation[k];
            permutation[k] = p;
            ++c[i];
            i = 1;
            yield permutation.slice();
            } else {
            c[i] = 0;
            ++i;
            }
        }
    }

    public permuteNonGenerator(permutation: number[]) {
        let length = permutation.length,
            result = [permutation.slice()],
            c = new Array(length).fill(0),
            i = 1, k, p;
      
        while (i < length) {
          if (c[i] < i) {
            k = i % 2 && c[i];
            p = permutation[i];
            permutation[i] = permutation[k];
            permutation[k] = p;
            ++c[i];
            i = 1;
            result.push(permutation.slice());
          } else {
            c[i] = 0;
            ++i;
          }
        }
        return result;
    }

    public readConfigFile(fileLocation: string){
        const config: string = fs.readFileSync(fileLocation, 'utf-8');
        let configJSON = JSON.parse(config);
        return configJSON;
    }

    public createNewOrder(combination: number[]){
        const newOrder = combination.map(x => this.indexLinkSourceMap.get(x)!);
        return newOrder;
    }

    public setNewOrder(configJSON: IConfigLinkTraversal, orderList: string[]){
        configJSON.actors[0].possibleLinkSources = orderList
        return configJSON;
    }

    public async runQuery(query: string): Promise<ITimingResults>{
        const startTime = this.getTimeSeconds();
        const resultStream = await this.engine.queryBindings(query, {"lenient": true});

        const resultTimings: number[] = [];
        let elapsed = 0;
        const consumedStream: Promise<ITimingResults> = new Promise((resolve, reject)=>{
            resultStream.on('data', () => {
                resultTimings.push(this.getTimeSeconds() - startTime);
            });
            resultStream.on('end', () => {
                elapsed = this.getTimeSeconds() - startTime;
                resolve({
                    elapsed: elapsed, 
                    resultArrivalTimes: resultTimings
                });
            })
        });
        return consumedStream
    }

    public async iterateExperiments(fileLocation: string, query: string){
        let resultObject: IQueryTimingResults[] = [];   
        const numExp = runExperiments.factorial(this.indexArray.length);
        let i = 1;
        for (const combination of this.permute(this.indexArray)){
            console.log(`Using combination: ${combination}, progress: ${i}/${numExp}`);
            const oldConfig = this.readConfigFile(fileLocation);

            const newOrder: string[] = this.createNewOrder(combination);
            const newConfig = this.setNewOrder(oldConfig, newOrder);

            fs.writeFileSync('configVariable/config-solid-var-priorities.json', JSON.stringify(newConfig));
            await this.createEngineFromPath('configVariable/config-solid-var-priorities.json');
            const queryExecutionTimes = [];
            const resultArrivalTimes: number[][] = [];
            for (let i = 0; i<this.nExecutions; i++){
                const timingResults = await this.runQuery(query)
                queryExecutionTimes.push(timingResults.elapsed);
                resultArrivalTimes.push(timingResults.resultArrivalTimes);
            }

            const meanExecutionTime = this.getMeanArray([...queryExecutionTimes]);
            const stdExecutionTime = this.getStdArray([...queryExecutionTimes]);    
            const transposeResultArrivalTimes = resultArrivalTimes[0].map((_, colIndex) => resultArrivalTimes.map(row => row[colIndex]));

            const meanArrivalTimes = transposeResultArrivalTimes.map(x => this.getMeanArray([...x]));
            const stdArrivalTimes = transposeResultArrivalTimes.map(x => this.getStdArray([...x]));
            const ansDistOutput = deficiencyMetrics.answerDistributionFunction(meanArrivalTimes, 500, false);
            const defAtComplete = deficiencyMetrics.defAtK(meanArrivalTimes.length, ansDistOutput.answerDist, ansDistOutput.linSpace);

            resultObject.push(
            {priorityOrder: combination,
            dieffAtComplete: defAtComplete,
            meanTotalExecutionTime: meanExecutionTime,
            stdTotalExecutionTime: stdExecutionTime,
            meanArrivalTimes: meanArrivalTimes,
            stdArrivalTimes: stdArrivalTimes
            });
            fs.writeFileSync('singleQueryTimingResults/timing_all_combinations.json', JSON.stringify(resultObject));
            i += 1;
            break;        
        }
    }

    public async randomlySampleCombinations(fileLocation: string, query: string, nSamples: number){
        let resultObject: IQueryTimingResults[] = []; 
        const permutations = this.permuteNonGenerator(this.indexArray);
        const sampledPermutations = _.sampleSize(permutations, nSamples)
        for (const combination of sampledPermutations){
            console.log(`Using combination: ${combination}`);
            const oldConfig = this.readConfigFile(fileLocation);

            const newOrder: string[] = this.createNewOrder(combination);
            const newConfig = this.setNewOrder(oldConfig, newOrder);

            fs.writeFileSync('configVariable/config-solid-var-priorities.json', JSON.stringify(newConfig));
            await this.createEngineFromPath('configVariable/config-solid-var-priorities.json');
            const queryExecutionTimes = [];
            const resultArrivalTimes: number[][] = [];
            for (let i = 0; i<this.nExecutions; i++){
                const timingResults = await this.runQuery(query)
                queryExecutionTimes.push(timingResults.elapsed);
                resultArrivalTimes.push(timingResults.resultArrivalTimes);
            }

            const meanExecutionTime = this.getMeanArray([...queryExecutionTimes]);
            const stdExecutionTime = this.getStdArray([...queryExecutionTimes]);    
            const transposeResultArrivalTimes = resultArrivalTimes[0].map((_, colIndex) => resultArrivalTimes.map(row => row[colIndex]));

            const meanArrivalTimes = transposeResultArrivalTimes.map(x => this.getMeanArray([...x]));
            const stdArrivalTimes = transposeResultArrivalTimes.map(x => this.getStdArray([...x]));
            
            const ansDistOutput = deficiencyMetrics.answerDistributionFunction(meanArrivalTimes, 500, false);
            const defAtComplete = deficiencyMetrics.defAtK(meanArrivalTimes.length, ansDistOutput.answerDist, ansDistOutput.linSpace);

            if (meanArrivalTimes[0]<this.bestFirstResult){
                this.bestFirstResult = meanArrivalTimes[0];
                this.bestFirstResultProgression.push(meanArrivalTimes[0]);
                console.log(`New best: ${this.bestFirstResult}`);
                console.log(`${this.bestFirstResultProgression}`);
            }

            resultObject.push(
            {priorityOrder: combination,
            dieffAtComplete: defAtComplete,
            meanTotalExecutionTime: meanExecutionTime,
            stdTotalExecutionTime: stdExecutionTime,
            meanArrivalTimes: meanArrivalTimes,
            stdArrivalTimes: stdArrivalTimes
            });
            fs.writeFileSync('singleQueryTimingResults/timing.json', JSON.stringify(resultObject));
        }
    }

    public async createEngine(){
        this.engine = await new this.queryEngineFactory().create({configPath: "configFiles/config-solid-variable-priorities.json"});
        // this.engine = await new this.queryEngineFactory().create();
    }

    public async createEngineFromPath(fileLocation: string){
        this.engine = await new this.queryEngineFactory().create({configPath: fileLocation});
    }

    public getTimeSeconds(){
        const hrTime: number[] = process.hrtime();
        const time: number = hrTime[0] + hrTime[1] / 1000000000;
        return time
    }

}

class deficiencyMetrics{
    public constructor(){
    }

    public static getLinSpace(maxVal: number, granularity: number){
        const stepSize = maxVal/granularity;
        const linSpace = [0];
        for (let i = 1; i<granularity; i++){
            linSpace.push(linSpace[i-1]+stepSize);
        }
        linSpace.push(maxVal);
        return linSpace

    }

    public static answerDistribution(t: number, answerTimings: number[]){
        if (t < answerTimings[0]){
            return 0;
        }
        if (t >= answerTimings[answerTimings.length - 1]){
            return answerTimings.length;
        }
        for (const [index, timing] of answerTimings.entries()){
            if (t > timing && t < answerTimings[index+1] && answerTimings[index+1] != undefined){
                return (index+1) + (t - timing)/(answerTimings[index+1] - timing);
            }
        }
        // This should never happen, is just for type setting
        return 0
    }
    
    public static answerDistributionFunction(answerTimings: number[], granularity: number, writeToFile: boolean): IAnswerDistributionOutput{
        const linSpace = this.getLinSpace(answerTimings[answerTimings.length-1], granularity);
        const answerDistributionFunction: number[] = [];
        for (const t of linSpace){
            answerDistributionFunction.push(this.answerDistribution(t, answerTimings));
        }

        if (writeToFile){
            fs.writeFileSync('answerDistFunction/answerDist.txt', JSON.stringify(answerDistributionFunction));
            fs.writeFileSync('answerDistFunction/linSpace.txt', JSON.stringify(linSpace));
        }
        return {answerDist: answerDistributionFunction, linSpace: linSpace};
    }

    public static defAtT(t: number, distribution: number[], linSpace: number[]){
        // Note: This implementation is not completely correct, we due to rounding of t to nearest point in the linspace
        // Note: We round up to nearest point in linSpace
        let cutoffIndex = 0;
        for (const [index, time] of linSpace.entries()){
            if (time > t){
                cutoffIndex = index;
                break;
            }
        }
        if (cutoffIndex == 0){
            throw new Error(`Invalid time ${t}, should be above ${0} and below ${linSpace[linSpace.length-1]}`);
        }
        const integral = this.integralSimpsonsRule(distribution.slice(0, cutoffIndex+1), linSpace.slice(0, cutoffIndex+1));
        console.log(`Diefficiency at t=${t}: ${integral}`);
        return integral;
    }

    public static defAtK(k: number, distribution: number[], linSpace: number[]){
        // Note: This rounds up so that atleast k results are obtained. Accuracy can be improved by higher granularity in answer distribution function
        if (k <= 0){
            throw new Error(`Very funny, k can't be below or equal to 0`);
        }
        let cutoffIndex = 0;
        for (const [index, results] of distribution.entries()){
            if (results >= k){
                cutoffIndex = index;
                break;
            }
        }
        if (cutoffIndex==0){
            cutoffIndex = distribution.length-1;
        }

        const integral = this.integralSimpsonsRule(distribution.slice(0, cutoffIndex+1), linSpace.slice(0, cutoffIndex+1));
        return integral;
    }

    public static integralSimpsonsRule(distribution: number[], linSpace: number[]){
        let integral = 0.0;
        for (let i = 2; i < distribution.length; i++) {
            // function delta takes two timestamp parameters and calculates 
            // differences as time units (hours, minutes, seconds or milliseconds)
            // not as simple as subtraction 
            let dt = linSpace[i] - linSpace[i-1];  
            integral += (distribution[i]+distribution[i-1])*dt;  // area of the trapezoid
        }
        integral /= 2.0;
        return integral;
    }
}


const queries = [
    "PREFIX snvoc: <https://solidbench.linkeddatafragments.org/www.ldbc.eu/ldbc_socialnet/1.0/vocabulary/> " + 
    "SELECT DISTINCT ?forumId ?forumTitle WHERE { " +
    "?message snvoc:hasCreator <https://solidbench.linkeddatafragments.org/pods/00000006597069767117/profile/card#me>. " +
    "?forum snvoc:containerOf ?message; " +
    "snvoc:id ?forumId; " +
    "snvoc:title ?forumTitle. " +
    "}" 
]
const runner = new runExperiments(15);
runner.iterateExperiments("configFiles/config-solid-variable-priorities.json", queries[0]);

export interface IConfigLinkTraversal{
    "@context" : string[],
    "import": string[],
    "@id": string,
    "type": string,
    "actors": IActorInterface[]
}

export interface IActorInterface{
    "@id": string;
    "@type": string;
    "beforeActors": {};
    "possibleLinkSources": string[];
    "mediatorRdfResolveHypermediaLinksQueue": {};
}

export interface ITimingResults{
    elapsed: number;
    resultArrivalTimes: number[];
}

export interface ICombinationTimingResults{
    results: IQueryTimingResults[];
}

export interface IQueryTimingResults{
    priorityOrder: number[];
    dieffAtComplete: number;
    meanTotalExecutionTime: number;
    stdTotalExecutionTime: number;
    meanArrivalTimes: number[];
    stdArrivalTimes: number[];
}

export interface IAnswerDistributionOutput{
    answerDist: number[];
    linSpace: number[];
}