
# Intro

A light weight rtc generator, plays a doorbell chime so host and visitors can find each other.


## Link 

https://one-1-doorbell-rtc.onrender.com  


## Goals

1 get it working  on a cheap server after I get it working offline through just my local wifi

2 get the link generator functioning so i test it on my phone

3 implement QR code generator so i can scan the link on my phone and test more easily

4 implement chimes

5 implement photo update, temporarily uploads a photo so each user (up to 4 photos, max 5mb, 5 photos including the user) can see the perspective of the other users  

6 less important: design UX/UI in figma and implement it in live code

7 extensive report on the repeatable patterns and interactions with this JS stack and libaries. 

7.2 code review on existing light weight rtcs. Possible future options. Possibly explore the power of paid server access if it's worth it.


## Learning goals

1 use a variety of helpful javascript stacks, this one makes use of peerJs.

1.2 Build experience with JS patterns to develop and get a better and reasoning with front end

2 experience with differient tiers of servers with the goal of keeping this webapp cheap (Render offers a more persistent server interaction while being free)

3 unexpectedly needed to practice git commits since server options integrate github repos quite well 

## Unexpected Learning
* importance of git commands interaction when using a server
* media query let's you control what you print
* CSS animations, key frames let you dictate transoformations 0% 25% 100% of the animation time
* render.com is cheap and good
* you may need a way to keep the server connection alive like an invisible ping on the host side
* you can do a lot with vanilla JS and CSS. 
