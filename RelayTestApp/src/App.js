import React, { Component } from 'react'
import './App.css';
import ids from './ids'; // CREATE ids.js AND EXPORT appId, appSecret (and optionally url)

// Screens
import LoginScreen from './LoginScreen';
import LoadingScreen from './LoadingScreen';
import MainMenuScreen from './MainMenuScreen';
import LobbyScreen from './LobbyScreen';
import GameScreen from './GameScreen';

let brainCloud = require("braincloud")
let colors = require('./Colors').colors

class App extends Component
{
    constructor()
    {
        super()

        this.shockwaveNextId = 0
        this.initBC()
        this.state = this.makeDefaultState()
    }
    
    // Initialize brainCloud library
    initBC()
    {
        // Create brainCloud Wrapper and initialize it
        this.bc = new brainCloud.BrainCloudWrapper("relayservertest")
        this.bc.initialize(ids.appId, ids.appSecret, "1.0.0")

        // Set server URL if specified in ids.txt
        if (ids.url) this.bc.brainCloudClient.setServerUrl(ids.url)

        // Log all the things so we can see what's going on (Turn that off for release)
        this.bc.brainCloudClient.enableLogging(true)
    }

    // Create default blank state for the app
    makeDefaultState()
    {
        return {
            screen: "login",    // Current screen we are on
            user: null,         // Our user
            lobby: null,        // Lobby with its members as received from brainCloud Lobby Service
            server: null,       // Server info (IP, port, protocol, passcode)
            shockwaves: []      // Players' created shockwaves
        }
    }

    // Reset the app to the login page with an error popup
    dieWithMessage(message)
    {
        // Close Relay/RTT/BC connections
        this.bc.relay.disconnect()
        this.bc.relay.deregisterSystemCallback()
        this.bc.relay.deregisterRelayCallback()
        this.bc.rttService.deregisterAllRTTCallbacks()
        this.bc.brainCloudClient.resetCommunication()

        // Pop alert message
        alert(message)

        // Initialize BC libs and start over
        this.initBC()

        // Go back to default login state
        this.setState(this.makeDefaultState())
    }

    // Clicked "Login"
    onLoginClicked(user, pass)
    {
        // Show "Loging in..." screen
        this.setState({ screen: "loginIn" })

        // Connect to braincloud
        this.username = user
        this.bc.authenticateUniversal(user, pass, true, this.onLoggedIn.bind(this))
    }

    // brainCloud authentication response
    onLoggedIn(result)
    {
        if (result.status === 200)
        {
            // Update username stored in brainCloud if first time loging in with that user.
            // This is necessary because the login username is not necessary the app username (Player name)
            if (this.username !== "" && this.username !== undefined)
            {
                this.bc.playerState.updateUserName(this.username)
            }
            else
            {
                this.username = result.data.playerName
            }

            // Set the state with our user information. Include in there our
            // color pick from last time.
            let localStorageColor = localStorage.getItem("color")
            if (localStorageColor == null) localStorageColor = "7" // Default to white
            this.setState({
                screen: "mainMenu",
                user: {
                    id: result.data.profileId,
                    name: this.username,
                    colorIndex: parseInt(localStorageColor),
                    isReady: false
                }
            })
        }
        else
        {
            this.dieWithMessage("Failed to login");
        }
    }

    // Clicked play from the main menu (Menu shown after authentication)
    onPlayClicked()
    {
        this.setState({ screen: "joiningLobby" })

        // Enable RTT service
        this.bc.rttService.enableRTT(() =>
        {
            console.log("RTT Enabled");

            // Register lobby callback
            this.bc.rttService.registerRTTLobbyCallback(this.onLobbyEvent.bind(this))

            // Find or create a lobby
            this.bc.lobby.findOrCreateLobby("CursorParty", 0, 1, { strategy: "ranged-absolute", alignment: "center", ranges: [1000] }, {}, null, {}, false, {colorIndex:this.state.user.colorIndex}, "all", result =>
            {
                if (result.status !== 200)
                {
                    this.dieWithMessage("Failed to find lobby")
                }
                // Success of lobby found will be in the event onLobbyEvent
            })
        }, () =>
        {
            if (this.state.screen === "joiningLobby")
            {
                this.dieWithMessage("Failed to enable RTT")
            }
            else
            {
                this.dieWithMessage("RTT Disconnected")
            }
        })
    }

    // Update events from the lobby Service
    onLobbyEvent(result)
    {
        // If there is a lobby object present in the message, update our lobby
        // state with it.
        if (result.data.lobby)
        {
            this.setState({lobby: { ...result.data.lobby, lobbyId: result.data.lobbyId }})

            // If we were joining lobby, show the lobby screen. We have the information to
            // display now.
            if (this.state.screen === "joiningLobby")
            {
                this.setState({ screen: "lobby" })
            }
        }

        if (result.operation === "DISBANDED")
        {
            if (result.data.reason.code == this.bc.reasonCodes.RTT_ROOM_READY)
            {
                // Server has been created. Connect to it
                this.bc.relay.registerRelayCallback(this.onRelayMessage.bind(this))
                this.bc.relay.registerSystemCallback(this.onSystemMessage.bind(this))
                this.bc.relay.connect({
                    ssl: false,
                    host: this.state.server.connectData.address,
                    port: this.state.server.connectData.ports.ws,
                    passcode: this.state.server.passcode,
                    lobbyId: this.state.server.lobbyId
                }, result =>
                {
                    this.setState({ screen: "game" })
                }, error => this.dieWithMessage("Failed to connect to server, msg: " + error))
            }
            else
            {
                // Disbanded for any other reason than ROOM_READY, means we failed to launch the game.
                this.onGameScreenClose()
            }
        }
        else if (result.operation == "STARTING")
        {
            // Game is starting, show loading screen
            this.setState({ screen: "connecting" })
        }
        else if (result.operation == "ROOM_READY")
        {
            // Server has been created, save connection info.
            this.setState({ server: result.data })
        }
    }

    // Called to terminate the current session and go back to the main menu
    onGameScreenClose()
    {
        this.bc.relay.deregisterRelayCallback()
        this.bc.relay.deregisterSystemCallback()
        this.bc.relay.disconnect()
        this.bc.rttService.deregisterAllRTTCallbacks()
        this.bc.rttService.disableRTT()

        let state = this.state
        state.screen = "mainMenu"
        state.lobby = null
        state.server = null
        state.user.isReady = false
        this.setState(state)
    }

    // The player has picked a different color in the Lobby menu
    onColorChanged(colorIndex)
    {
        let state = this.state
        this.state.user.colorIndex = colorIndex
        this.setState(state)

        // Update the extra information for our player so other lobby members are notified of
        // our color change.
        this.bc.lobby.updateReady(this.state.lobby.lobbyId, this.state.user.isReady, {colorIndex: colorIndex})
    }

    // Owner of the lobby clicked the "Start" button
    onStart()
    {
        let state = this.state
        this.state.user.isReady = true
        this.setState(state)

        // Set our state to ready and notify the lobby Service.
        this.bc.lobby.updateReady(this.state.lobby.lobbyId, this.state.user.isReady, {colorIndex: this.state.user.colorIndex})
    }

    // A relay message coming from another player
    onRelayMessage(netId, data)
    {
        let state = this.state;
        let memberProfileId = this.bc.relay.getProfileIdForNetId(netId)
        let member = state.lobby.members.find(member => member.profileId == memberProfileId)
        let str = data.toString('ascii');
        console.log(str)
        let json = JSON.parse(str)

        switch (json.op)
        {
            // Player moved the mouse
            case "move":
                member.pos = {x: json.data.x, y: json.data.y};
                break

            // Player clicked to create a shockwave
            case "shockwave":
                this.createShockwave(json.data, colors[member.extra.colorIndex])
                break
        }

        this.setState(state)
    }

    // Received a Relay Server system message
    onSystemMessage(json)
    {
        if (json.op == "DISCONNECT") // A member has disconnected from the game
        {
            let state = this.state;
            let member = state.lobby.members.find(member => member.profileId == json.profileId)
            if (member) member.pos = null // This will stop displaying this member
            this.setState(state)
        }
    }

    // Called by the gamescreen when our player moves the mouse
    onPlayerMove(pos)
    {
        let state = this.state;
        let member = state.lobby.members.find(member => member.profileId == state.user.id)
        member.pos = {x: pos.x, y: pos.y};
        this.setState(state)

        // We send the movement update as unreliable. Exact position is not important and we can accept
        // packet loss.
        // Note: This is using the JS API which uses only WebSocket, meaning there will never be packet loss. But other
        // API can connect to the same game instance and might communicate to the relay server in UDP.
        this.bc.relay.send(Buffer.from(JSON.stringify({op:"move",data:pos}), 'ascii'), this.bc.relay.TO_ALL_PLAYERS, false, true, this.bc.relay.CHANNEL_HIGH_PRIORITY_1);
    }

    // Player has clicked to create a shockwave
    onPlayerShockwave(pos)
    {
        // We send the shockewave event as reliable because such action needs to be guaranteed.
        this.bc.relay.send(Buffer.from(JSON.stringify({op:"shockwave",data:pos}), 'ascii'), this.bc.relay.TO_ALL_PLAYERS, true, false, this.bc.relay.CHANNEL_HIGH_PRIORITY_2);

        // Create the shockwave instance on our instance
        this.createShockwave(pos, colors[this.state.user.colorIndex])
    }

    // Create a shocwave at position and color on the game screen
    createShockwave(pos, color)
    {
        let shockwaves = this.state.shockwaves;
        let shockwave = {
            pos: {x: pos.x, y: pos.y},
            color: color,
            id: this.shockwaveNextId++ // This is used to ID the HTML element so the CSS animation doesn't bug.
        }
        shockwaves.push(shockwave)
        this.setState({shockwaves: shockwaves})

        // Set a timeout to kill that shockwave instance in 1 second
        setTimeout(() =>
        {
            let shockwaves = this.state.shockwaves;
            shockwaves.splice(shockwaves.indexOf(shockwave), 1)
            this.setState({shockwaves: shockwaves})
        }, 1000)
    }

    // Render ReactJS components
    render()
    {
        switch (this.state.screen)
        {
            case "login":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <p>Relay Server Test App.</p>
                            <LoginScreen onLogin={this.onLoginClicked.bind(this)}/>
                        </header>
                    </div>
                )
            }
            case "loginIn":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <LoadingScreen text="Logging in..." />
                        </header>
                    </div>
                )
            }
            case "mainMenu":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <p>Relay Server Test App.</p>
                            <MainMenuScreen user={this.state.user}
                                onPlay={this.onPlayClicked.bind(this)} />
                        </header>
                    </div>
                )
            }
            case "joiningLobby":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <LoadingScreen text="Joining..." onBack={this.onGameScreenClose.bind(this)} />
                        </header>
                    </div>
                )
            }
            case "lobby":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <p>Relay Server Test App.</p>
                            <p>LOBBY</p>
                            <LobbyScreen user={this.state.user} lobby={this.state.lobby} onBack={this.onGameScreenClose.bind(this)} onColorChanged={this.onColorChanged.bind(this)} onStart={this.onStart.bind(this)} />
                        </header>
                    </div>
                )
            }
            case "connecting":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <LoadingScreen text="Joining Match..." />
                            <small>If this takes a while, don't worry. This means a new server is warming up just for you.</small>
                        </header>
                    </div>
                )
            }
            case "game":
            {
                return (
                    <div className="App">
                        <header className="App-header">
                            <p>Relay Server Test App.</p>
                            <small>Move mouse around and click to create shockwaves.</small>
                            <GameScreen user={this.state.user} lobby={this.state.lobby} shockwaves={this.state.shockwaves} onBack={this.onGameScreenClose.bind(this)} onPlayerMove={this.onPlayerMove.bind(this)} onPlayerShockwave={this.onPlayerShockwave.bind(this)} />
                        </header>
                    </div>
                )
            }
            default:
            {
                return (
                    <div className="App">
                        Invalid state
                    </div>
                )
            }
        }
    }
}

export default App;