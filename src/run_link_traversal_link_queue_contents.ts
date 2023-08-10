import * as fs from 'fs';
import * as _ from 'lodash';
import { ISparqlBenchmarkRunnerArgs, SparqlBenchmarkRunner } from './sparql_query_runner';

"To start endpoint"
"node engines/query-sparql-link-traversal-solid/bin/http.js --max-old-space-size 8192 -c context-client-temp-testing-remove.json -t 300 --idp void -i --lenient -w 1 -l error -p 3001"

function getQuerySets(queryDir: string){
    const querySets: Record<string, string[]> = {};
    const dirFiles = fs.readdirSync(queryDir);
    console.log(dirFiles)
    for (const [i, queryFile] of dirFiles.entries()){
        const query = fs.readFileSync(queryDir+'/'+queryFile, 'utf-8');
        querySets[queryFile] = [query];
    }
    return querySets;
}
async function main(){
    const querySets = getQuerySets('queries_local');
    const optionsRunner: ISparqlBenchmarkRunnerArgs = {
        endpoint: "http://localhost:3001/sparql", 
        querySets: querySets, 
        replication: 1, 
        warmup: 0, 
        timestampsRecording: true,
        logger: console.log,
        upQuery: "SELECT * WHERE { <https://solidbench.linkeddatafragments.org/pods/00000000000000000933/profile/card#me> a ?o } LIMIT 1"
    };
    const SparqlQueryRunner = new SparqlBenchmarkRunner(optionsRunner)
    const results = await SparqlQueryRunner.run();
    console.log(results)
}

main();


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