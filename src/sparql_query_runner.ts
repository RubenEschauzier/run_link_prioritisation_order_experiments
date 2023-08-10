import { SparqlEndpointFetcher } from 'fetch-sparql-endpoint';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra'

/**
 * Executes query sets against a SPARQL endpoint.
 */
export class SparqlBenchmarkRunner {
  private readonly endpoint: string;
  private readonly querySets: Record<string, string[]>;
  private readonly replication: number;
  private readonly warmup: number;
  private readonly timestampsRecording: boolean;
  private readonly logger?: (message: string) => void;
  private readonly upQuery: string;
  private readonly additionalUrlParamsInit?: URLSearchParams;
  private readonly additionalUrlParamsRun?: URLSearchParams;
  private readonly timeout?: number;

  public constructor(options: ISparqlBenchmarkRunnerArgs) {
    this.endpoint = options.endpoint;
    this.querySets = options.querySets;
    this.replication = options.replication;
    this.warmup = options.warmup;
    this.timestampsRecording = options.timestampsRecording;
    this.logger = options.logger;
    this.upQuery = options.upQuery || 'SELECT * WHERE { ?s ?p ?o } LIMIT 1';
    this.additionalUrlParamsInit = options.additionalUrlParamsInit;
    this.additionalUrlParamsRun = options.additionalUrlParamsRun;
    this.timeout = options.timeout;
  }

  /**
   * Once the endpoint is live,
   * execute all query sets against the SPARQL endpoint.
   * Afterwards, all results are collected and averaged.
   */
  public async run(options: IRunOptions = {}): Promise<IBenchmarkResults> {
    // Await query execution until the endpoint is live
    await this.waitUntilUp();
    // Execute queries in warmup
    this.log(`Warming up for ${this.warmup} rounds\n`);
    await this.executeQueries({}, this.warmup);

    // Execute queries
    const results: IBenchmarkResults = {};
    this.log(`Executing ${Object.keys(this.querySets).length} queries with replication ${this.replication}\n`);
    if (options.onStart) {
      await options.onStart();
    }
    await this.executeQueries(results, this.replication);
    if (options.onStop) {
      await options.onStop();
    }

    // Average results
    for (const key in results) {
      results[key].time = Math.floor(results[key].time / this.replication);
      results[key].timestamps = results[key].timestamps.map(t => Math.floor(t / this.replication));
    }

    return results;
  }

  /**
   * Execute all queries against the endpoint.
   * @param data The results to append to.
   * @param iterations The number of times to iterate.
   */
  public async executeQueries(data: IBenchmarkResults, iterations: number): Promise<void> {
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (const name in this.querySets) {
        const startTimeExecution = process.hrtime()
        const test = this.querySets[name];
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const id in test) {
          this.log(`\rExecuting query ${name}:${id} for iteration ${iteration + 1}/${iterations}`);
      
          const query = test[id];
          let count: number;
          let time: number;
          let timestamps: number[];
          let metadata: Record<string, any>;
          let errorObject: Error | undefined;

          // Execute query, and catch errors
          try {
            ({ count, time, timestamps, metadata } = await this.executeQuery(query));
          } catch (error: unknown) {
            errorObject = <Error> error;
            if ('partialOutput' in <any> errorObject) {
              ({ count, time, timestamps, metadata } = (<any>errorObject).partialOutput);
            } else {
              count = 0;
              time = 0;
              timestamps = [];
              metadata = {};
            }
          }
          // After the execution or time-out of query, we add one last timestamp to the tracker. This timestamp represents the endtime of the query
          // for data processing, we repeat the last observation of link queue on this timestamp, so we can, for example, see if the link queue was empty
          // for a long time before query end
          const linkQueueEntriesEvolution = JSON.parse(fs.readFileSync('testNumDifferentPriorities/linkQueueEvolution.txt', 'utf-8'));
          fs.writeFileSync('logLinkQueue/'+name+'.txt', JSON.stringify(linkQueueEntriesEvolution));
          const linkQueueTimeStamps = JSON.parse(fs.readFileSync('testNumDifferentPriorities/linkQueueEvolutionTimeStamps.txt', 'utf-8'));
          fs.writeFileSync('logLinkQueue/'+name+'.timestamps.txt', JSON.stringify(linkQueueTimeStamps));
          // const linkQueueEntriesEvolutionFull = JSON.parse(fs.readFileSync('testNumDifferentPriorities/linkQueueEvolutionFull.txt', 'utf-8'));
          // fs.writeFileSync('logLinkQueue/'+name+'.full.txt', JSON.stringify(linkQueueEntriesEvolutionFull));
          for (const file of fs.readdirSync('intermediateResultFiles')){
            console.log(file)
            fs.copyFileSync(`intermediateResultFiles/${file}`, `logLinkQueueFull/${name}.${file}.txt`);
          }
          fsExtra.emptyDirSync('intermediateResultFiles');
          



          // Store results
          if (!data[name + id]) {
            data[name + id] = { name, id, count, time, timestamps, error: Boolean(errorObject), metadata };
          } else {
            const dataEntry = data[name + id];

            if (errorObject) {
              dataEntry.error = true;
            }

            dataEntry.time += time;

            // Combine timestamps
            const length = Math.min(dataEntry.timestamps.length, timestamps.length);
            for (let i = 0; i < length; ++i) {
              dataEntry.timestamps[i] += timestamps[i];
            }
          }

          // Delay if error
          console.log(`Query execution took: ${this.countTime(startTimeExecution)}`);
          if (errorObject) {
            this.log(`\rError occurred at query ${name}:${id} for iteration ${iteration + 1}/${iterations}: ${errorObject.message}\n`);

            // Wait until the endpoint is properly live again
            await this.sleep(10_000);
            await this.waitUntilUp();
        
          }
        }
      }
    }
    this.log(`\rExecuted all queries\n`);
  }

  /**
   * Execute a single query
   * @param query A SPARQL query string
   */
  public async executeQuery(query: string): Promise<{
    count: number; time: number; timestamps: number[]; metadata: Record<string, any>;
  }> {
    fs.writeFileSync('testNumDifferentPriorities/numPriorities.txt', JSON.stringify(0));
    fs.writeFileSync('testNumDifferentPriorities/differentLinkTypes.txt', JSON.stringify({}));
    fs.writeFileSync('testNumDifferentPriorities/linkQueueEvolution.txt', JSON.stringify([]));
    fs.writeFileSync('testNumDifferentPriorities/linkQueueEvolutionTimeStamps.txt', JSON.stringify([]), {encoding: 'utf-8', flag: 'w'});

    const fetcher = new SparqlEndpointFetcher({
      additionalUrlParams: this.additionalUrlParamsRun,
    });
    let promiseTimeout: Promise<any> | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (this.timeout) {
      promiseTimeout = new Promise((resolve, reject) => {
        timeoutHandle = <any> setTimeout(() => reject(new Error('Timeout for running query')), this.timeout);
      });
    }
    const promiseFetch = fetcher.fetchBindings(this.endpoint, query)
      .then((results: any) => new Promise<{
        count: number; time: number; timestamps: number[]; metadata: Record<string, any>;
      }>((resolve, reject) => {
        const hrstart = process.hrtime();
        const startTime: number = hrstart[0] + hrstart[1] / 1000000000;
        // Write first timestamp for link queue evolution logger (this is t=0)
        console.log(`Start time: ${startTime}`)
        let count = 0;
        const timestamps: number[] = [];
        let metadata: Record<string, any> = {};
        results.on('metadata', (readMetadata: any) => {
          metadata = readMetadata;
        });
        results.on('data', () => {
          count++;
          if (this.timestampsRecording) {
            timestamps.push(this.countTime(hrstart));
          }
        });
        results.on('error', (error: any) => {
          error.partialOutput = {
            count,
            time: this.countTime(hrstart),
            timestamps,
            metadata,
          };
          reject(error);
        });
        results.on('end', () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          resolve({ count, time: this.countTime(hrstart), timestamps, metadata });
        });
      }));
    return promiseTimeout ? Promise.race([ promiseTimeout, promiseFetch ]) : promiseFetch;
  }

  /**
   * Based on a hrtime start, obtain the duration.
   * @param hrstart process.hrtime
   */
  public countTime(hrstart: [number, number]): number {
    const hrend = process.hrtime(hrstart);
    return hrend[0] * 1_000 + hrend[1] / 1_000_000;
  }

  /**
   * Check if the SPARQL endpoint is available.
   */
  public isUp(): Promise<boolean> {
    const fetcher = new SparqlEndpointFetcher({
      additionalUrlParams: this.additionalUrlParamsInit,
    });
    let timeoutHandle: NodeJS.Timeout | undefined;
    const promiseTimeout = new Promise<boolean>(resolve => {
      timeoutHandle = <any> setTimeout(() => resolve(false), 10_000);
    });
    const promiseFetch = fetcher.fetchBindings(this.endpoint, this.upQuery)
      .then((results: any) => new Promise<boolean>(resolve => {
        results.on('error', () => {
          clearTimeout(timeoutHandle);
          resolve(false);
        });
        results.on('data', () => {
          // Do nothing
        });
        results.on('end', () => {
          clearTimeout(timeoutHandle);
          resolve(true);
        });
      }));
    return Promise.race([ promiseTimeout, promiseFetch ])
      .catch(() => false);
  }

  /**
   * Wait until the SPARQL endpoint is available.
   */
  public async waitUntilUp(): Promise<void> {
    let counter = 0;
    while (!await this.isUp()) {
      await this.sleep(1_000);
      this.log(`\rEndpoint not available yet, waited for ${++counter} seconds...`);
    }
    this.log(`\rEndpoint available after ${counter} seconds.\n`);
    await this.sleep(10_000);
    fsExtra.emptyDirSync('intermediateResultFiles');
  }

  /**
   * Sleep for a given amount of time.
   * @param durationMs A duration in milliseconds.
   */
  public async sleep(durationMs: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, durationMs));
  }

  /**
   * Log a message.
   * @param message Message to log.
   */
  public log(message: string): void {
    return this.logger?.call(this.logger, message);
  }

  // public appendToList(currentList: number[], newList: number){
  //   return [...currentList, newList]
  // }
  // public appendToFile(newList: number, fileLocation: string){
  //   const oldList: number[] = JSON.parse(fs.readFileSync(fileLocation, 'utf-8'));
  //   const toSaveList = this.appendToList(oldList, newList);
  //   fs.writeFileSync(fileLocation, JSON.stringify(toSaveList));
  // }

}

export interface ISparqlBenchmarkRunnerArgs {
  /**
   * URL of the SPARQL endpoint to send queries to.
   */
  endpoint: string;
  /**
   * Mapping of query set name to an array of SPARQL query strings in this set.
   */
  querySets: Record<string, string[]>;
  /**
   * Number of replication runs.
   */
  replication: number;
  /**
   * Number of warmup runs.
   */
  warmup: number;
  /**
   * If a timestamps column should be added with result arrival times.
   */
  timestampsRecording: boolean;
  /**
   * Destination for log messages.
   * @param message Message to log.
   */
  logger?: (message: string) => void;
  /**
   * SPARQL SELECT query that will be sent to the endpoint to check if it is up.
   */
  upQuery?: string;
  /**
   * Additional URL parameters that must be sent to the endpoint when checking if the endpoint is up.
   */
  additionalUrlParamsInit?: URLSearchParams;
  /**
   * Additional URL parameters that must be sent to the endpoint during actual query execution.
   */
  additionalUrlParamsRun?: URLSearchParams;
  /**
   * A timeout for query execution in milliseconds.
   *
   * If the timeout is reached, the query request will NOT be aborted.
   * Instead, the query is assumed to have silently failed.
   *
   * This timeout is only supposed to be used as a fallback to an endpoint-driven timeout.
   */
  timeout?: number;
}

export interface IRunOptions {
  /**
   * A listener for when the actual query executions have started.
   */
  onStart?: () => Promise<void>;
  /**
   * A listener for when the actual query executions have stopped.
   */
  onStop?: () => Promise<void>;
}

/**
 * Results for all queries in a query set.
 * Maps query set name to the query result.
 */
export type IBenchmarkResults = Record<string, IBenchmarkResult>;

/**
 * Result for a single query.
 */
export interface IBenchmarkResult {
  name: string;
  id: string;
  count: number;
  time: number;
  timestamps: number[];
  error: boolean;
  metadata: Record<string, any>;
}