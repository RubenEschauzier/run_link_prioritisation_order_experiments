import * as fs from 'fs';
import * as path from 'path';
import type { ILinkQueue, ILink } from '@comunica/bus-rdf-resolve-hypermedia-links-queue';

export class LinkQueuePriorityMetadata implements ILinkQueue {
  public readonly links: ILink[];
  public readonly priorities: number[];

  public priorityDict: Record<string, number>;
  public numPriorities: number;
  public usePriority: boolean;

  public logFileTimeStamps: string;
  public logFileLinkQueueEvolution: string;
  public randomId: number;
  public queueEvolution: IQueueEvolution;

  public constructor(possibleLinkSources: string[], logFileQueueEvolution: string, priority: boolean) {
    this.priorities = [];
    this.links = [];

    this.priorityDict = {};
    possibleLinkSources.map((x, i) => this.priorityDict[x] = i + 1);
    this.numPriorities = possibleLinkSources.length + 1;
    console.log('1')
    this.usePriority = priority;
    console.log(path.join(logFileQueueEvolution, 'queryNum.txt'));
    let queryNum: number = JSON.parse(fs.readFileSync(path.join(logFileQueueEvolution, 'queryNum.txt'), 'utf-8'));
    console.log('2')
    console.log(queryNum)
    // make dir for queryNumber
    fs.mkdirSync(path.join(logFileQueueEvolution, `query${queryNum}`));
    // We assign a random ID to each link queue, as each query can make auxillary queues (that do not impact results).
    // The largest queue log file is the actual link queue
    console.log('3')
    this.randomId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    this.logFileLinkQueueEvolution = path.join(logFileQueueEvolution, `query${queryNum}`, `${this.randomId}.txt`);
    console.log(this.logFileLinkQueueEvolution);
    this.queueEvolution = { linkQueueContent: [], timeStamps: []};
    fs.writeFileSync(path.join(logFileQueueEvolution, 'queryNum.txt'), JSON.stringify(queryNum+=1));
    console.log('5')
  }

  // Code for making figure nothing more should not be in release
  public appendToList(currentList: number[][], newList: number[]) {
    return [ ...currentList, newList ];
  }

  public appendToFile(newList: number[], fileLocation: string) {
    const oldList: number[][] = JSON.parse(fs.readFileSync(fileLocation, 'utf-8'));
    const toSaveList = this.appendToList(oldList, newList);
    fs.writeFileSync(fileLocation, JSON.stringify(toSaveList));
  }

  public appendToListTimeStamp(currentList: number[], newList: number) {
    return [ ...currentList, newList ];
  }

  public appendToFileTimeStamp(newList: number, fileLocation: string) {
    const oldList: number[] = JSON.parse(fs.readFileSync(fileLocation, 'utf-8'));
    const toSaveList = this.appendToListTimeStamp(oldList, newList);
    fs.writeFileSync(fileLocation, JSON.stringify(toSaveList));
  }

  public getTimeSeconds(): number {
    const hrTime: number[] = process.hrtime();
    const time: number = hrTime[0] + hrTime[1] / 1_000_000_000;
    return time;
  }

  public readRecordsLinkQueue(fileLocation: string) {
    const records: Record<number, IQueueEvolution> = JSON.parse(fs.readFileSync(fileLocation, 'utf-8'));
    return records;
  }

  public writeToFile(fileLocation: string) {
    const objectToWrite = { linkQueueContent: JSON.stringify(this.queueEvolution.linkQueueContent), timeStamps: JSON.stringify(this.queueEvolution.timeStamps) };
    fs.writeFileSync(fileLocation, JSON.stringify(objectToWrite));
  }

  public updateQueueEvolution() {
    this.queueEvolution.linkQueueContent = [ ...this.queueEvolution.linkQueueContent, [ ...this.priorities ]];
    this.queueEvolution.timeStamps.push(this.getTimeSeconds());
  }

  public pushPriority(link: ILink): boolean {
    // Insert link into queue, here we assume that we keep priorities sorted by always inserting at proper index
    const linkPriority = !link.metadata?.source || !this.priorityDict[link.metadata.source] ? this.numPriorities : this.priorityDict[link.metadata.source];
    const insertIndex = this.findInsertIndex(this.priorities, linkPriority);

    this.links.splice(insertIndex, 0, link);
    this.priorities.splice(insertIndex, 0, linkPriority);
    return true;
  }

  public pushNonPriority(link: ILink): boolean {
    const linkPriority = !link.metadata?.source || !this.priorityDict[link.metadata.source] ? this.numPriorities : this.priorityDict[link.metadata.source];
    this.priorities.push(linkPriority);
    this.links.push(link);

    this.updateQueueEvolution();
    this.writeToFile(this.logFileLinkQueueEvolution);

    return true;
  }

  public push(link: ILink): boolean {
    if (this.usePriority) {
      return this.pushPriority(link);
    }
    try{
      return this.pushNonPriority(link);
    }
    catch(err){
      console.log(err)
    }
    return this.pushNonPriority(link);
  }

  public getSize(): number {
    return this.links.length;
  }

  public isEmpty(): boolean {
    return this.links.length === 0;
  }

  public pop(): ILink | undefined {
    this.priorities.shift();

    this.updateQueueEvolution();
    this.writeToFile(this.logFileLinkQueueEvolution);

    return this.links.shift();
  }

  public peek(): ILink | undefined {
    return this.links[0];
  }

  private findInsertIndex(priorityQueue: number[], priorityToInsert: number) {
    let low = 0,
        high = priorityQueue.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (priorityQueue[mid] < priorityToInsert) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    // Ensure FIFO property for links with equal priority
    while (low < priorityQueue.length) {
      if (priorityQueue[low + 1] == priorityToInsert) {
        low += 1;
      } else {
        break;
      }
    }
    return low;
  }
}

export interface IQueueEvolution{
  linkQueueContent: number[][];
  timeStamps: number[];
}
