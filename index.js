/**
 * 
 * Rather than
 * 
 * https://www.googleapis.com/youtube/v3
 * /channels
 */
// Config Comes from Config.JSON

// Gets Uploads Ids
//https://www.googleapis.com/youtube/v3/channels?id={channel Id}&key={API key}&part=contentDetails

// Queries for Videos via
//https://www.googleapis.com/youtube/v3/playlistItems?playlistId={"uploads" Id}&key={API key}&part=snippet&maxResults=50
import fs from "node:fs";
import env from 'node:process';
import fetch from "node-fetch";
import process from 'node:process';
import express from 'express';
import helmet from 'helmet';
import colors from 'colors';
import beautify from 'json-beautify';
import dotenv from 'dotenv';
dotenv.config();
const YT_V3 = `https://www.googleapis.com/youtube/v3/`;
const UPDATE_EVERY = 1000 * 60 * 45;
// Class Used for Loading and Managing Channels
class Channels {
    static API_KEY = null;
    static channels = [];
    static isWaitingRoom = {}
    static async update() {
        // Can On
        Channels.channels.forEach(async (ch)=>{
            if(!ch.serve) return;
            ch.getLatestVideos(Channels.API_KEY);
        });
    }
    static Channel = class Channel {
        constructor(name, id, serve, maxResults = 25){
            this.name = name;
            this.channelId = id;
            this.serve = serve ?? true;
            this.uploadsId = null;
            this.maxResults = maxResults ?? 25;
            this.upcomingBroadcasts = [];
        }  

        // fetches uploads playlist Id
        async load(key){
            const response = await fetch(`${YT_V3}channels?id=${this.channelId}&key=${key}&part=contentDetails`);
            this.uploadsId = (await response.json()).items[0].contentDetails.relatedPlaylists.uploads
            console.log("Upload ID Loaded:".yellow, `${this.uploadsId}`.green);
        }

        // Fetches Latest (maxResults Videos)

        async getLatestVideos(key){
            // adds and or replaces upcoming broadcasts
            const playlistQuery = `${YT_V3}playlistItems?playlistId=${this.uploadsId}&key=${key}&part=snippet&maxResults=${this.maxResults}`;

            let response = await fetch(playlistQuery);
            response = await response.json();

            let ids = (await Promise.all(response.items.map(async (video) => {
                return video.snippet.resourceId.videoId;
            })))

            let idQuery = ids.reduce((a,b) => a +','+ b);

            let videosResponse = (await 
                (await fetch(`${YT_V3}videos?part=snippet&id=${idQuery}&key=${key}&fields=items(snippet(title,liveBroadcastContent))`)).json()
            ).items.map(e=>e.snippet);


            let upcomingBroadcasts = ids.map((id, index) => {
                return {
                    id: id,
                    title: videosResponse[index].title,
                    live: videosResponse[index].liveBroadcastContent
                }
            }).filter(video => video.live !== 'none');

            upcomingBroadcasts.forEach((broadcast)=>this.upcomingBroadcasts[broadcast.id] = broadcast);
        }
    }

    constructor(path_to_config = "./config.json"){
        const data = fs.readFileSync(path_to_config);
        this.config = JSON.parse(data);
        this.config.query.apiKey = env.env.API_KEY; //Fuck you
        this.maxResults = this.config.query.maxResults;
        this.API_KEY = this.config.query.apiKey;
        Channels.API_KEY = this.API_KEY;
        console.log(`CONFIG LOADED: ${beautify(this.config, null, 2, 100).green}\n`.yellow);

    }

    async loadChannels(){
        Channels.channels = await Promise.all(Object.keys(this.config.channels).map(async (channelName, i) => { 
           const channel = new Channels.Channel(channelName,
                this.config.channels[channelName].id, 
                this.config.channels[channelName]?.serve,
                this.config.channels[channelName]?.maxResults
           );
           await channel.load(this.API_KEY);
           return channel;
        }));
    }

}

/**
 * Express App Stuff
 *  
 **/
const server = new express();
const PORT = env.env.PORT;

async function listen(){
    server.listen(PORT, () => {
        console.log(`\nServer is listening on Port: `.yellow, `${PORT}`.green, "\n");
    });
}

// Must be run after loadChannels Function
async function routing() {
 //server.use(helmet());
 server.get('/', async function(req, res){
    res.send("Access through /sena, /brolime, ect");
 });

 Channels.channels.forEach(async (channel)=>{
    if(!channel.serve)
        return;
    server.get(`/${channel.name}`, async (req, res) => {

        //builds response
        let response = {
            channel: channel.name,
            channelId: channel.channelId,
            upcomingBroadcasts: {}
        };

        for(const value in channel.upcomingBroadcasts){
            response.upcomingBroadcasts[value] = {
                title: channel.upcomingBroadcasts[value].title,
                id: channel.upcomingBroadcasts[value].id,
                url: `https://www.youtube.com/watch?v=${channel.upcomingBroadcasts[value].id}`,
                live: channel.upcomingBroadcasts[value].live
            }
        }

        res.json(response);
    });
 });

}

const CHANNELS = new Channels('./config.json');


async function load(){
    await CHANNELS.loadChannels();
    await Channels.update();
    setInterval(async ()=>{
        console.log(`Updating Waiting Room Playlist`.yellow);
        try {
            await Channels.update();
            console.log(`Updated Waiting Room Playlist!`.green);
        } catch (e) {
            console.log(`Failed to Update Waiting Room Playlist`.red);
        }
    }, UPDATE_EVERY);
    // Sets up Routing
    await routing();
    listen();
}

await load();