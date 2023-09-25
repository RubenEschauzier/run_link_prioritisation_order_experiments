Repository to replicate the results of the paper "How Does the Link Queue Evolve during Traversal-Based Query Processing?"
To replicate the results follow these steps:
First build the comunica package:
```
cd comunica-link-queue-tracker
yarn install
```
Then, generate a solidbench benchmark dataset in ```/generated``` using the [instructions](https://github.com/SolidBench/SolidBench.js).
After genereting the dataset, you can copy the (subset of) generated queries from ```/generated/out-queries``` to ```/queries```. In each query file you should only keep
a single query, to prevent unnecessary work.

The next step is to start the Comunica sparql endpoint which we will query. To do so execute:
```
cd comunica-link-queue-tracker
node --max-old-space-size=8192 engines/query-sparql-link-traversal-solid/bin/http.js -c context-client-temp-testing-remove.json --idp void -p 3001
```
Finally, we are ready to run the queries. Note that saving will be done by default to /tmp/queueAnalysis, to change it go to ```comunica-link-queue-tracker/engines/config-query-sparql-link-traversal/config/config-solid-default-priority.json``` and change the line 

```
      "logFileQueueEvolution": "/tmp/queueAnalysis",
```
to your own absolute path.
Saving is done by keeping count of the number of queries run using a ```queryNum``` file with a single number denoting the query ran. Then for each query a directory will be made and a .txt file with a random integer as id will contain the log queue. Due to the usage of `up queries` by our query runner, some logs of queues will be empty, these can safely be deleted. 

The log files should then be passed to the [plot repository](https://github.com/RubenEschauzier/plot_link_queue_content_figures) in the `/data` folder.

(I am aware this whole process is a bit convoluted, so if you need any help with your replication don't hestitate to contact me at ruben.eschauzier@ugent.be)