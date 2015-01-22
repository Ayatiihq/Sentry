#::sentry

The detection and protection system.

![](http://tf2wiki.net/w/images/thumb/e/ee/Engywithsg.png/350px-Engywithsg.png)

##::Introduction
Sentry is a cloud based automated piracy protection application. 
It was written entirely in Node besides some C/C++ based binaries needed for content matching with a mongodb backend. We hosted it on Digital Ocean with AWS used for storage. 

It was used to protect mainly Bollywood films and music and new releases from music labels in the UK and Ireland. It worked on a job based system, metadata for each 'campaign' (album, movie, book) was stored in the job and depending on the strategy per campaign the system would launch automated searching of google, yahoo, bing. It would identify potential infringements, extrapolate and explore each link to try to find offending content. If and when it did find content in the case of music at least it would automatically download that content and autoverify the content using a spectral content matcher. It would then send DMCA emails automatically to search engines to get the material removed. It would also attempt to contact the siteowner by scraping emails from the site and/or using whois info to serve the appropriate  DMCA notice.