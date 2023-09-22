import * as fs from 'fs';
import * as _ from 'lodash';
import { ISparqlBenchmarkRunnerArgs, SparqlBenchmarkRunner } from './sparql_query_runner';

function getQuerySets(queryDir: string){
    const querySets: Record<string, string[]> = {};
    const dirFiles = fs.readdirSync(queryDir);

    for (const [i, queryFile] of dirFiles.entries()){
        const query = fs.readFileSync('queries/'+queryFile, 'utf-8');
        querySets[queryFile] = [query];
    }
    return querySets;
}
async function main(currentQueryLinkQueueLogPath: string){
    const querySets = getQuerySets('queries');
    const optionsRunner: ISparqlBenchmarkRunnerArgs = {
        endpoint: "http://localhost:3001/sparql", 
        querySets: querySets, 
        replication: 1, 
        warmup: 0, 
        timestampsRecording: true,
        logger: console.log,
        upQuery: "SELECT * WHERE { <https://localhost:3000/pods/00000000000000000933/profile/card#me> a ?o } LIMIT 1"
    };
    const SparqlQueryRunner = new SparqlBenchmarkRunner(optionsRunner, currentQueryLinkQueueLogPath);
    const results = await SparqlQueryRunner.run();
    console.log(results)
}
// This should be equal to "logFileQueueEvolution" in engines/config-query-sparql-link-traversal/config/config-solid-default-priority.json
const queryLogPath = "/tmp/queueAnalysis/";
main(queryLogPath);


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