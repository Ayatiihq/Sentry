#::governor

![](http://www.comeexplorecanada.com/newfoundland_labrador/st_johns/guv-nor/1.jpg)

##Introduction

The Governor is responsible for setting the heartbeat of the Sentry system. It's a singleton that has the following responsibilities:

 * Keeping track of campaigns and associated tasks
 * Keeping Scraper queues hydrated with jobs
 * Performing 'cron'-type tasks to keep the databases maintained

##Campaigns

All active campaigns have associated tasks such as initiating statistical collections, updating statuses/counts and, the main one, creating scraping jobs for matching scrapers.

###Matching Scrapers

Depending on the type of media a campaign is protecting, there will be some scrapers that do not make sense for it. For this purpose, the Governor would compile a list of scrapers that should be used for a particular campaign.

The qualifiers would be:
 * Scraper supports particular media type
 * Scraper is not in 'ignore list' for campaign

###Interval

The interval represents the interval between scrapes. This can be tied to specific Scrapers or apply to the entire campaign.

This is required as different campaigns will require different levels of detection. The interval represents a **minute** value that is the minimum time between a Scraper last finished a job for a particular campaign, and the time the next job will be dispatched.

When an interval is hit, the Governor would check first to make sure that the last job had actually finished before starting another job.

###Scraper Job Tracking

Every scraper job created for a campaign will be tracked from creation to completion in the database. This will allow us to make sure we are not creating new, similar, jobs before the last one has had a chance to complete. Also, it allows us at once to get a view of the complete queue state and gather metrics on time-to-completion for a particular scraper job, an entire campaign, or general completion time for a Scraper across campaigns.

##Scrapers

The Governor uses the ScraperCache to enumerate the available Scrapers. Each scraper has a package.json file that details any specifics (such as custom queues, matching media types, zone types etc). Using the information provided by the Scraper, the Governor will dispatch jobs for that Scraper for each campaign that that Scraper matches.

Jobs are received by any workers that are listening to the appropriete queues. Generally scraping tasks will be handled by the generic Scraper workers listening to the scraper.* queues. Custom scrapers (those that need specific hardware or zone requirements) will be listening on custom queues.

###Jobs

Jobs are represented as a JSON string. They contain information that is used by the workers to complete the request. Generic information contained in a Job would be:

 * jobId
 * campaignId
 * scraperId
 * timeStarted
 * $extraData

###Split Jobs

 For some types of media, it will make sense to split out the scraping job into multiple, specific, jobs. For instance, while protecting a TV series. In addition to the standard search for infringements, individual episode names/ids can equate to multiple jobs, which will ensure more accurate and faster scraping.

##Cron

There are clean up tasks that need to be performed on interval or on a trigger. They could be database clean-up tasks, starting of new services, or timely notifications.

Cron tasks are plugins to the Governor and are initiated at startup.