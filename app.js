'use strict'

var fs = require('fs')
var passwordValidator  = require('password-validator')
var crypto = require('crypto')
var qr = require('qr-image')

var config = require('./config.json')

//testnet by default
var nem = require("nem-sdk").default
var endpoint = nem.model.objects.create("endpoint")(nem.model.nodes.defaultTestnet, nem.model.nodes.defaultPort)
var networkId = nem.model.network.data.testnet.id
var recordPath = "./storage/testnet/"

if(config.mainNet){
	console.log("*****RUNNING ON MAINNET!!!*****")
	endpoint = nem.model.objects.create("endpoint")(nem.model.nodes.defaultMainnet, nem.model.nodes.defaultPort)
	networkId = nem.model.network.data.mainnet.id
	recordPath = "./storage/"
} else {
	console.log("App running on testenet")
}

const Telegram = require('telegram-node-bot')
const TelegramBaseController = Telegram.TelegramBaseController
const TextCommand = Telegram.TextCommand
const tg = new Telegram.Telegram(config.telegram_key, {
	webAdmin: {
		port: config.local_port,
		host: config.host
	//	host: '188.166.249.46'
	}
})

var schema = new passwordValidator ()
schema
.is().min(6)			// Minimum length 6 
.is().max(50) 			// Maximum length 50
.has().uppercase()		// Must have uppercase letters 
.has().lowercase()		// Must have lowercase letters 
.has().not().spaces()	// Should not have spaces 

/**
 *
 *   Alerts
 *
**/

function checkAccounts(){
	var list = []
	fs.readdir(recordPath, (err, files) => {
		if(!files) return
		if(err){
			console.log("ERROR in checkAccounts")
			return
		}
		
		files.forEach(file => {
			if(file.split('.')[1] == "json")
				list.push(file.split('.')[0])
		})
		
		var processUsers = function(x){
			if( x < list.length ) {
				var curr_mainid = ""
				var curr_mainadd = ""
				var old_account_info = ""
				var new_account_info = ""
				var old_mosaic_info = ""
				var new_mosaic_info = ""

				getUserRecord(list[x],function(res){
				//	console.log("******* Callback from getUserRecord. Data: "
					for (var a = 0; a < res.length; a++){
						if(res[a].type == "main"){
							curr_mainid = res[a].info.teluserid
							curr_mainadd = res[a].info.telwalletaddress
							old_account_info = res[a]
							old_mosaic_info = res[a].mosaics
						}
					}
				})
				getAccountMosaics(curr_mainadd, function(res){
					if(res[0] != "address must be valid"){
						compareMosaics({id:curr_mainid,add:curr_mainadd},old_mosaic_info,[res[0],res[1],res[2]])
					}
				})
				processUsers(x+1)
			}
		}
		processUsers(0)
	})
}

function listMosaics(mosaics) {
	var temp_mosaicNames = []
	var temp_mosaicBalances = []

	mosaics.forEach(function(curr,ind){
	var currentQ = curr.quantity
	var currentN = curr.mosaicId.name

	temp_mosaicNames.push(currentN)
	temp_mosaicBalances.push(currentQ)

	})
	return {names:temp_mosaicNames,balance:temp_mosaicBalances}
}

function compareData(data1,currentNewData){
	var currentAddress = data1.info.telwalletaddress
	var currentUserId = data1.info.teluserid
	var currentOldData = data1.data

	var changes = []
	var changeBalance = 0

	//only check for balance changes for now
	if(currentOldData.account.balance != currentNewData.account.balance){
		console.log("FOUND a difference in balance")
		var temparr = ["balance",currentOldData.account.balance,currentNewData.account.balance]
		changeBalance = currentNewData.account.balance - currentOldData.account.balance
		changes.push(temparr)

		var bal1 = (currentOldData.account.balance/1000000).toFixed(6)
		var bal2 = (currentNewData.account.balance/1000000).toFixed(6)

		//updating user account data
		//should comapare and if ever update user mosaicowned
		updateUserRecord(currentUserId,"data",currentNewData)
		tg.api.sendMessage(
			currentUserId, 
			"<b>UPDATE:</b>\nBalance for ["+currentAddress+"] has changed from "+bal1+" to "+bal2,
			{
				parse_mode: 'HTML'
			},
		)
	}
}

function compareMosaics(userdata,currentOldMosaics,currentNewMosaics){
	var currentAddress = userdata.add
	
	var currentUserId = userdata.id

	var messageforUser = "The following mosaics have changed balance:\n"
	var balanceChange = false
	var xemChanged = false

	var oldMosaicsListed = listMosaics(currentOldMosaics)
	var newMosaicsListed = listMosaics(currentNewMosaics[0])
	
	var difference = 0
	
	if(currentOldMosaics.length == currentNewMosaics[0].length){
		//amount of mosaic types remained the same
		var oldcurrBal = 0
		var newcurrBal = 0

		oldMosaicsListed.names.forEach(function(crr,ind){
			oldcurrBal = oldMosaicsListed.balance[ind]
			if(newMosaicsListed.names.indexOf(crr) == -1)
				newcurrBal = 0
			else
				newcurrBal = newMosaicsListed.balance[newMosaicsListed.names.indexOf(crr)]

			if(oldcurrBal != newcurrBal){				
				var currMosaicIndex = currentNewMosaics[1].indexOf(crr)
				var curMosaicDivisibility = currentNewMosaics[2][currMosaicIndex].divisibility
				
				difference = ((newcurrBal - oldcurrBal)/Math.pow(10,curMosaicDivisibility)).toFixed(2)
				
				if(difference > 0)
					difference = "+" + difference
				
				messageforUser += crr+": "+newcurrBal/Math.pow(10,curMosaicDivisibility).toFixed(2)+" ("+difference+")\n"
				balanceChange = true
			}
		})
	} else {
		//amount of mosaic types has changed
		if(currentOldMosaics.length > currentNewMosaics.length){
			oldMosaicsListed.names.forEach(function(crr,ind){		//old mosaics have more mosaic types
				oldcurrBal = oldMosaicsListed.balance[ind]

				if(newMosaicsListed.names.indexOf(crr) == -1)
					newcurrBal = 0
				else
					newcurrBal = newMosaicsListed.balance[newMosaicsListed.names.indexOf(crr)]

				if(oldcurrBal != newcurrBal){
					var currMosaicIndex = currentNewMosaics[1].indexOf(crr)
					var curMosaicDivisibility = currentNewMosaics[2][currMosaicIndex].divisibility
					
					difference = ((newcurrBal - oldcurrBal)/Math.pow(10,curMosaicDivisibility)).toFixed(2)
					if(difference > 0)
						difference = "+" + difference
					messageforUser += crr+": "+newcurrBal/Math.pow(10,curMosaicDivisibility).toFixed(2)+" ("+difference+")\n"
					balanceChange = true
				}
			})

		} else{
			//theres more mosaic types in new than old
			newMosaicsListed.names.forEach(function(crr,ind){		//new mosaics have more mosaic types
				newcurrBal = newMosaicsListed.balance[ind]

				if(oldMosaicsListed.names.indexOf(crr) == -1)
					oldcurrBal = 0
				else
					oldcurrBal = oldMosaicsListed.balance[oldMosaicsListed.names.indexOf(crr)]

				if(newcurrBal != oldcurrBal){
					var currMosaicIndex = currentNewMosaics[1].indexOf(crr)
					var curMosaicDivisibility = currentNewMosaics[2][currMosaicIndex].divisibility
					
					if(crr == "xem") xemChanged = true
					
					difference = ((newcurrBal - oldcurrBal)/Math.pow(10,curMosaicDivisibility)).toFixed(2)
					if(difference > 0)
						difference = "+" + difference
					messageforUser += crr+": "+newcurrBal/Math.pow(10,curMosaicDivisibility).toFixed(2)+" ("+difference+")\n"
					balanceChange = true
				}
			})
		}
	}

	if(balanceChange){//will only update once if any balance is different
		console.log("*****Detected balance change in user account: "+currentUserId)
		if(xemChanged){
			//xem has changed, so update userrecord for "data"
			getAccountData(currentAddress, function(res){
				if(res != "address must be valid"){
					updateUserRecord(currentUserId,"data",res)
				}
			})
		}
		updateUserRecord(currentUserId,"mosaics",currentNewMosaics[0])
		tg.api.sendMessage(currentUserId, "UPDATE:\n"+messageforUser)
	}
}

/**
 *
 *   Accounts
 *
**/

function createAccountWallet(userinfo,cb){
	//This will take user telegram ID, telegram username, password
	console.log("*****Create Wallet for user: ")

	var userID = userinfo.id
	var userUsername = userinfo.username
	var userPass = userinfo.pass
	var userWalletName = userinfo.wName


	console.log("User ID: "+userID)
	console.log("User Name: "+userUsername)
	console.log("User Pass: "+userPass)
	console.log("User Wallet Name: "+userWalletName)

	getUserRecord(userinfo.id, function(res){
		if(!res){ //this means that no user is found and a new wallet can be made for the user
			var createWalletResult = ""
			var privateKey = getAccountKey(userID+"_"+userUsername+"_"+userWalletName+"_"+userPass)
			var keyPair = nem.crypto.keyPair.create(privateKey)
			var publicKey = keyPair.publicKey.toString()
			var networkID = -104 //Mainnet (104): N ,  Testnet (-104): T,   Mijin (96): M
			if(config.mainNet){
				console.log("*******CREATING A MAINNET WALLET*********")
				networkID = 104
			}

			var address = nem.model.address.toAddress(publicKey, networkID) 

			createUserRecord({wName:userWalletName,userId:userID,userName:userUsername,pPhrase:userPass,address:address}, function(res){
				if(res){
					createUserQRcode(userID,address,function(){
						//see if anything changes here when I use mainnet
						var createWalletResult = nem.model.wallet.importPrivateKey(userWalletName, userPass, privateKey, networkId)
						var rawwallet = getRawAccountWallet(createWalletResult)
						cb({walletName:userWalletName,password:userPass,privateKey:privateKey,address:address,rawwallet:rawwallet})
					})
				}
				else {
					cb("Error: User Record not created")
				}
			})
		} else {
			cb(false)
		}
	})
}

function getRawAccountWallet(wallet){
	var wordArray = nem.crypto.js.enc.Utf8.parse(JSON.stringify(wallet))	// Convert stringified wallet object to word array
	var base64 = nem.crypto.js.enc.Base64.stringify(wordArray)	// Word array to base64
	return base64
}

function getAccountData(add, cb){
	var userAddress = add
	nem.com.requests.account.data(endpoint, userAddress).then(function(res) {
		cb(res)
	}, function(err) {
		cb(err.data.message)
	})
}

function getAccountMosaics(add, cb){
	var userAddress = add
	var accountMosaics = ""
	var mosaicDefinitions = ""
	var mosaicDefinitionsIndex = []
	var mosaicDefinitionsProperties = []
	
	nem.com.requests.account.mosaics.owned(endpoint, userAddress).then(function(res1) {
		accountMosaics = res1.data
		nem.com.requests.account.mosaics.allDefinitions(endpoint, userAddress).then(function(res2) {
			mosaicDefinitions = res2.data
			mosaicDefinitions.forEach(function(res){
				var sNa = res.id.name
				var val = res.properties[0].value
				
				var namespaceId = res.id.namespaceId
				var divisibility = res.properties[0].value
				var initialSupply = res.properties[1].value
				var transferable = res.properties[2].value
				
				mosaicDefinitionsIndex.push(sNa)
				mosaicDefinitionsProperties.push({namespaceId,divisibility,initialSupply,transferable})
				
			})
			cb([accountMosaics,mosaicDefinitionsIndex,mosaicDefinitionsProperties])
			
		}, function(err) {
			console.log(err.data.message)
			cb(false)
		})
	}, function(err) {
		console.log(err.data.message)
		cb(false)
	})
}

function getMosaicDefinitions(add, cb){
	var userAddress = add
	nem.com.requests.account.mosaics.allDefinitions(endpoint, userAddress).then(function(res) {
		cb(res.data)
	}, function(err) {
		cb(err)
	})
}

function getAccountKey(passphrase){
	return nem.crypto.helpers.derivePassSha(passphrase, 6000).priv
}

/**
 *
 *   User Records
 *
**/

function createUserRecord(userdata, callback){
	let type = "main"   //***for now type is only main. 3 types: main, external
	let info = {
		teluserid:userdata.userId,
		telusername:userdata.userName,
		telwalletaddress:userdata.address,
		telwalletName:userdata.wName,
	}
	let data = {
		meta:{},
		account:{}
	}
	let mosaics = []
	let addresbook = []
	
	let filedata = JSON.stringify([{type,info,data,mosaics}])

	fs.writeFile(recordPath+userdata.userId+".json",filedata, (err) => {
		if (err)
			callback(false)
		else{
			callback(true)
		}
	})
}

function getUserRecord(uid, callback){
	var jsonData = false

	try {
		jsonData = require(recordPath+uid+".json")
	} catch (err) {
		console.log("No Record found for ID: "+uid)
	}
	callback(jsonData)
}

function updateUserRecord(uid,type,tempdata){
	console.log("*****update user record")
	getUserRecord(uid, function(res){
		//search for which wallet is set to type=main
		switch (type){
			case "type":
				res[0].type = tempdata
				break
			case "info":
				res[0].info = tempdata
				break
			case "data":
				res[0].data = tempdata
				break
			case "mosaics":
				res[0].mosaics = tempdata
				break
			case "addressbook":
				res[0].addressbook = tempdata
				break
		}

		let filedata = JSON.stringify(res)
		fs.writeFile(recordPath+uid+".json", filedata, (err) => {
			if (err)
				console.log("ERROR: records update FAILED")
			else
				console.log("records updated successful")
		})
	})
}

function createUserQRcode(userID,text_string,cb){
	console.log("****Create QR code with filename: "+userID)
	var qr_svg = qr.image(text_string, { type: 'png' })
	qr_svg.pipe(require('fs').createWriteStream(recordPath+userID+".png"))
	cb()
}

function userAddressbook(userID,command,data){
	//add an address
	
	//edit address
	
	//delete address
	
}
/**
 *
 *   Transactions
 *
**/

function sendTransaction(data,cb){
	console.log("****sendTransaction")

	if(!data)
		cb("Error: Something went wrong.")
	
	//Checks again if the password is valid
	if(!schema.validate(data.user.userPass)){
		cb("Invalid Password")
	}
	
	var userUsername = data.user.userUsername
	var userID = data.user.userID
	var userWalletName = data.user.userWalletName
	var userPass = data.user.userPass
	
	var transMosaic = data.transaction.transMosaic
	var transAddress = data.transaction.transAddress
	var transAmount = data.transaction.transAmount 
	var transMessage = data.transaction.transMessage

	var key = getAccountKey(userID+"_"+userUsername+"_"+userWalletName+"_"+userPass)
	
	var common = nem.model.objects.create("common")("", key)
	var namespaceId = transMosaic.split(":")[0]
	var mosaicName = transMosaic.split(":")[1]

	//amount fee and message fee is already calcuated an added to transaction object
	if(mosaicName == "xem"){
		console.log("*****SENDING XEM")
		var transferTransaction = nem.model.objects.create("transferTransaction")(transAddress, transAmount, transMessage)
		var transactionEntity = nem.model.transactions.prepare("transferTransaction")(common, transferTransaction, networkId)
		
		nem.model.transactions.send(common, transactionEntity, endpoint).then(function(res) {
			cb(res)
		}, function(err) {
			cb(err)
		})
	} else {
		console.log("*****SENDING MOSAIC")
		
		var mosaicDefinitionMetaDataPair = nem.model.objects.get("mosaicDefinitionMetaDataPair")
		var transferTransaction = nem.model.objects.create("transferTransaction")(transAddress, nem.utils.helpers.cleanTextAmount(1), transMessage)

		nem.com.requests.namespace.mosaicDefinitions(endpoint,namespaceId).then(function(res) {
			var neededDefinition = nem.utils.helpers.searchMosaicDefinitionArray(res.data, [mosaicName])
			var adjustedMosaicAmount = 0
			var fullMosaicName  = namespaceId + ":" + mosaicName
			var currentMosaicDvisibility = neededDefinition[fullMosaicName].properties[0].value		
			var cleanMosaicAmount = transAmount * Math.pow(10,currentMosaicDvisibility)
			var mosaicAttachment = nem.model.objects.create("mosaicAttachment")(namespaceId, mosaicName, cleanMosaicAmount)

			transferTransaction.mosaics.push(mosaicAttachment)
			
			if(undefined === neededDefinition[fullMosaicName]) return console.error("Mosaic not found !")

			mosaicDefinitionMetaDataPair[fullMosaicName] = {}
			mosaicDefinitionMetaDataPair[fullMosaicName].mosaicDefinition = neededDefinition[fullMosaicName]
			mosaicDefinitionMetaDataPair[fullMosaicName].supply = neededDefinition[fullMosaicName].properties[1].value //add a supply as it is required in calculateMosaics in model/fee.js

			var transactionEntity = nem.model.transactions.prepare("mosaicTransferTransaction")(common, transferTransaction, mosaicDefinitionMetaDataPair, networkId)

			nem.model.transactions.send(common, transactionEntity, endpoint).then(function(res) {
				console.log(res)
				cb(res)
			}, function(err) {
				console.log("Error: nem.model.transactions.send")
				console.log(err)
				cb(err)
			})
		},
		function(err) {
			console.log("ERROR HERE")
			console.error(err)
		})
	}
}

/**
 *
 *   classes
 *
**/

    /* Otherwise */
	

class OtherwiseController extends TelegramBaseController {
	handle($) {
		console.log("Unknown user input")
		console.log("From: "+$.message.from.id)
		console.log("Input: "+$.message.text)

		mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
		$.runMenu(mainMenu)
	}
	
    get routes() {
        return handle
    }
}

    /* Help and Start */

class HelpController extends TelegramBaseController {
    /**
     * @param {Scope} $
     */
    helpHandler($) {
		console.log("*****Help Controller")
		
		var helpMessage = "Hello! Welcome to the <b>Nem Wallet Telegram Bot</b>.\n\n"
		helpMessage += "Use the menu to navigate.\n\n"
		helpMessage += "<b>Create/Check Wallet</b> - Create a new Nem Wallet that will be associated with your Telegram account.\n"
		helpMessage += "<b>Check Balance</b> - Check the balance of your mosaics.\n"
		helpMessage += "<b>Send Transaction</b> - Send mosaics to a nem address.\n"
		helpMessage += "<b>Address Book</b> - View, add, edit and delete addresses."
		
		mainMenu['message'] = helpMessage
		$.runMenu(mainMenu)

    }
    get routes() {
        return {
            'helpCommand': 'helpHandler'
        }
    }
}

    /* Balance */

class BalanceController extends TelegramBaseController {
    /**
     * @param {Scope} $
     */
	balanceHandler ($) {
		console.log("****BalanceController  User: "+$.message.from.id)
		getUserRecord($.message.from.id, function(res){
			var mainwallet = res[0]
			if(res) {
				var userAddress = mainwallet.info.telwalletaddress
				getAccountMosaics(userAddress,function(res){
					var balanceString = ""
					if(res[0]){
						res[0].forEach(function(mosaics,index){
							var currMosaicAmount = mosaics.quantity
							var currMosaicNamespaceID = mosaics.mosaicId.namespaceId
							var currMosaicMosaicName = mosaics.mosaicId.name
							var currMosaicIndex = res[1].indexOf(currMosaicMosaicName)
							var curMosaicDivisibility = res[2][currMosaicIndex].divisibility
							
							var currMosaicAmountfixed = currMosaicAmount / Math.pow(10,curMosaicDivisibility)
							
							balanceString += currMosaicMosaicName.toUpperCase()+" = "+currMosaicAmountfixed+"\n"
						})
					} else 
						balanceString = "Error: Something went wrong."
					//$.sendMessage(balanceString)
					mainMenu['message'] = balanceString
					$.runMenu(mainMenu)
				})
			} else {
				mainMenu['message'] = "You don't have a wallet yet.\nChoose Create/Check Wallet to create one."
				$.runMenu(mainMenu)
			}
		})

	}
	get routes() {
		return {
			'balanceCommand': 'balanceHandler'
		}
	}
}

    /* Wallet */

class WalletController extends TelegramBaseController {
    /**
     * @param {Scope} $
     */
	walletHandler ($) {
		console.log("****WalletController  User: "+$.message.from.id)
		getUserRecord($.message.from.id,function(res){
			if(res){
				mainMenu['message'] = "<b>Nem Wallet Address</b>\n"+res[0].info.telwalletaddress
				$.runMenu(mainMenu)
				
				if(config.mainNet){
					$.sendPhoto({ path: __dirname+'/storage/'+$.message.from.id+'.png'})
				} else{
					$.sendPhoto({ path: __dirname+'/storage/testnet/'+$.message.from.id+'.png'})
				}

			} else {	
				var userid = $.message.from.id
				var username = $.message.from.username
				var walletName = ""
				var password = ""
				
				userConfirm['message'] = 'Are you sure you want to make a new Telegram Wallet?'
				$.runMenu(userConfirm)
				$.waitForRequest.then($ => {
					if ($.message.text == 'yes'){
						userInput['message'] = 'What would you like to name your wallet?'
						$.runMenu(userInput)
						$.waitForRequest.then($ => {
							if ($.message.text != 'Exit'){
								walletName = $.message.text
								userInput['message'] = "<b>Please enter your wallet PASSPHRASE.</b>\n\n<b>FORMAT:</b>\n - 6-50 characters.\n - Atleast 1 uppercase letter and atelast 1 lowercase letter.\n - no spaces.\n<b>NOTE:</b>\n<i> You will need to enter this PASSPHRASE before transactions.</i>\n<b>IMPORTANT:</b>\n<i> YOU CANNOT CHANGE YOUR PASSPHRASE LATER ON, SO MAKE SURE YOU CAN RECALL IT.</i>"
								$.runMenu(userInput)
								$.waitForRequest.then($ => {
									if ($.message.text != 'Exit'){
										password = $.message.text
										var passAttempt = schema.validate(password, { list: true })
										if(passAttempt.length == 0){
											userConfirm['message'] = 'We will create a new wallet for you now. Do you Confirm?'
											$.runMenu(userConfirm)
											$.waitForRequest.then($ => {
												if ($.message.text == 'yes'){
													createAccountWallet({wName:walletName,id:userid,username:username,pass:password},function(res){
														if(res){
															var messagetoUser = "<b>Here is your new wallet information:</b>\n"
															messagetoUser += "<i>Please save it and dont lose it.</i>\n\n"
															messagetoUser += "<b>Wallet Address:</b>\n"
															messagetoUser += res.address+"\n\n"
															messagetoUser += "<b>Wallet Name:</b>\n"
															messagetoUser += res.walletName+"\n\n"
															messagetoUser += "<b>Password:</b><i>You CANNOT change your password.</i>\n"
															messagetoUser += res.password+"\n\n"
															messagetoUser += "<b>Raw Wallet:</b>\n"
															messagetoUser += res.rawwallet+"\n\n"
															
															mainMenu['message'] = messagetoUser
															$.runMenu(mainMenu)
															
															$.sendMessage("Here's the QR for your new wallet address:").then(function(){			
																if(config.mainNet)
																	$.sendPhoto({ path: __dirname+'/storage/'+$.message.from.id+'.png'})
																else
																	$.sendPhoto({ path: __dirname+'/storage/testnet/'+$.message.from.id+'.png'})
															})
															
															getAccountData(res.address, function(res){
																updateUserRecord($.message.from.id,"data",res)
															})
															getAccountMosaics(res.address, function(res){
																if(res)
																	updateUserRecord($.message.from.id,"mosaics",res[0])
																else
																	mainMenu['message'] = "Oops. Something went wrong."
															})
														}
														else
															mainMenu['message'] = "Oops. Something went wrong."
													})
												}
											})
										} else {
											mainMenu['message'] = "Invalid password."
											$.runMenu(mainMenu)
										}
									} else {
										mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
										$.runMenu(mainMenu)
									}
								})
							} else {
								mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
								$.runMenu(mainMenu)
							}
						})
					} else {
						mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
						$.runMenu(mainMenu)
					}
				})
			}
		})
	}
	get routes() {
		return {
			'walletCommand': 'walletHandler'
		}
	}
}

    /* Sending */

class sendController extends TelegramBaseController {
   /**
   * @param {Scope} $
   */
    sendHandler($) {
		console.log("****sendController  User: "+$.message.from.id)
		getUserRecord($.message.from.id, function(res){
			if(res) {
				var sendMosaic = ""
				var sendAddress = ""
				var sendAmount = 0.0
				var sendMessage = false
				var sendPassword = ""
				
				var userid = $.message.from.id
				var username =  res[0].info.telusername
				var userAddress = res[0].info.telwalletaddress
				var userWallet = res[0].info.telwalletName
								
				var mosaicOptions = { 
					message: 'Choose the mosaic you would like to send:',
					oneTimeKeyboard: true,
				}
				var mosaicnameList = []
				var mosaicnamepairList = []
								
				var currAddbook = res[0].addressbook
				var currAddbookNames = []
				var currAddbookAddress = []
				
				getAccountMosaics(userAddress,function(res){
					if(res){
						//load up menu with user mosaics
						var mosaic_choices = res
						res[0].forEach(function(mosaics,index){
							var currMosaicIndex = res[1].indexOf(mosaics.mosaicId.name)
							var curMosaicDivisibility = res[2][currMosaicIndex].divisibility
							mosaicnameList.push(mosaics.mosaicId.name)
							mosaicnamepairList.push(mosaics.mosaicId.namespaceId+":"+mosaics.mosaicId.name)
							mosaicOptions[mosaics.mosaicId.name+" = "+mosaics.quantity / Math.pow(10,curMosaicDivisibility)] = defaultMenuFunction
						})
						mosaicOptions['Exit'] = defaultMenuFunction
						$.runMenu(mosaicOptions) 		//TO GET MOSAIC PAIRS//list all available mosaics of the user
						$.waitForRequest.then($ => {
							if($.message.text.indexOf(" = ") != -1 && $.message.text != 'Exit'){	//If user doesn't choose exit or proper mosaic string is passed
								var pickedMosaicName = $.message.text.split(" = ")[0]
								var pickedMosaicIndex = mosaicnameList.indexOf(pickedMosaicName)
								var picekdMosaicNamePair = mosaicnamepairList[pickedMosaicIndex]
								
								sendMosaic = picekdMosaicNamePair
								
								var AddressList = { 
									oneTimeKeyboard: true,
									message: '<b>Please enter the address to send to.</b>\nOr choose from your address book below.\nYou have '+currAddbook.length+' items in your address book.'
								}
								
								currAddbook.forEach(function(item){
									AddressList[item[0]+" = "+item[1]] = defaultMenuFunction
									currAddbookNames.push(item[0])
									currAddbookAddress.push(item[1])
								})
								AddressList['Exit'] = defaultMenuFunction
								
								$.runMenu(AddressList)
								$.waitForRequest.then($ => {
									sendAddress = $.message.text
									if($.message.text.split(" = ").length > 1)
										sendAddress = $.message.text.split(" = ")[1]
									
									if($.message.text != 'Exit' && nem.model.address.isValid(sendAddress)){
										userInput['message'] = '<b>Please enter amount.</b>\nAdd a message by place a space after amount. Example: 0.25 This is my payment'
										$.runMenu(userInput) //Ask for amount and message(optional)
										$.waitForRequest.then($ => {
											if($.message.text != 'Exit'){	//There should be atleast 2 strings in the transaction string
												sendAmount = parseFloat($.message.text.split(" ")[0])
												if($.message.text.split(" ").length > 1) //this means that there is a message
													sendMessage = $.message.text.substr($.message.text.indexOf($.message.text.split(" ")[1]),$.message.text.length)
												
												if(sendAmount > 0.0){
													userInput['message'] = '<b>***Please enter your PASSPHRASE***</b>'
													$.runMenu(userInput)
													$.waitForRequest.then($ => {
														if($.message.text != 'Exit'){
															//validate password, if valid store password
															sendPassword = $.message.text
															if(schema.validate(sendPassword)){
																//SEND THE TRANSACTION!!!
																
																let user = {
																	userUsername: username,
																	userID: userid,
																	userWalletName: userWallet,
																	userPass: sendPassword,
																}
																let transaction = {
																	transMosaic: sendMosaic,
																	transAddress: sendAddress,
																	transAmount: sendAmount,
																	transMessage: sendMessage,	
																	
																}
																	
																console.log("****SENDING*****")
																console.log(user)
																console.log(transaction)
																
																sendTransaction({user,transaction}, function(res){
																	if(res.code == 1)
																		mainMenu['message'] = "<b>Transaction SUCCESS!</b>\nPlease allow some time for the transaction to be included."
																	else
																		mainMenu['message'] = "<b>Transaction Failed</b>\nPlease check the wallet address, available balance or password.\nType in /Send to start a new transaction."
																	$.runMenu(mainMenu)
																})
															}
														} else {
															mainMenu['message'] = "Invalid password."
															$.runMenu(mainMenu)
														}
													})
												} else {
													mainMenu['message'] = "Invalid amount."
													$.runMenu(mainMenu)
												}
											} else{
												mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
												$.runMenu(mainMenu)
											}
										})
									} else {
										if($.message.text != 'Exit')
											mainMenu['message'] = "Invalid Address"
										else
											mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
										$.runMenu(mainMenu)
									}
								})
							} else {
								if($.message.text != 'Exit')
									mainMenu['message'] = "Invalid mosaic type"
								else
									mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
								$.runMenu(mainMenu)
							}
						})
					}
				})
			} else {
				mainMenu['message'] = "You don't have a wallet yet.\nChoose Create/Check Wallet to create one."
				$.runMenu(mainMenu)
			}
		})
    }
    get routes() {
        return {
            'sendCommand': 'sendHandler'
        }
    }
}

    /* Address Book */

class addressbookController extends TelegramBaseController {
   /**
   * @param {Scope} $
   */
    addressbookHandler($) {
		console.log("****addressbookController  User: "+$.message.from.id)
		var AddressList = { 
			oneTimeKeyboard: true,
		}
		var currUserID = $.message.from.id
		getUserRecord(currUserID, function(res){
			if(res){
				var currAddbook = res[0].addressbook
				var currAddbookNames = []
				var currAddbookAddress = []
				
				AddressList['message'] = 'You have '+res[0].addressbook.length+' items in your address book.'
				
				currAddbook.forEach(function(item){
					AddressList[item[0]] = defaultMenuFunction
					currAddbookNames.push(item[0])
					currAddbookAddress.push(item[1])
				})
				AddressList['Add'] = defaultMenuFunction
				AddressList['Exit'] = defaultMenuFunction
				
				$.runMenu(AddressList)
				$.waitForRequest.then($ => {
					if($.message.text != 'Exit' && currAddbookNames.indexOf($.message.text) > -1){
						var chosenAddressIndex = currAddbookNames.indexOf($.message.text)
						addressbookItem['message'] = currAddbookAddress[chosenAddressIndex]
						$.runMenu(addressbookItem)
						$.waitForRequest.then($ => {
							if($.message.text == 'View'){	//TODO: Option to view address in QR image
								console.log("QR code: "+ currAddbookAddress[chosenAddressIndex] + " Address: " + currAddbookNames[chosenAddressIndex])
							} else if($.message.text == 'Delete Entry'){
								//DELETE address to user record							
								userConfirm['message'] = "Are you sure you want to delete " + currAddbookNames[chosenAddressIndex] + " ["+currAddbookAddress[chosenAddressIndex]+"]?"
								$.runMenu(userConfirm)
								$.waitForRequest.then($ => {
									if($.message.text == 'yes'){
										console.log("DELETE: "+ currAddbookAddress[chosenAddressIndex] + " Address: " + currAddbookNames[chosenAddressIndex])
										currAddbook.splice(chosenAddressIndex,1)
										updateUserRecord(currUserID,"addressbook",currAddbook)
										mainMenu['message'] = "Address Deleted"
										$.runMenu(mainMenu)
									} else{
										mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
										$.runMenu(mainMenu)
									}
								})
							} else if ($.message.text == 'Edit Entry'){
								//DONE: EDIT
								editAddress['message'] = 'What do you want to edit?'
								$.runMenu(editAddress)
								$.waitForRequest.then($ => {
									var toEdit = false
									if($.message.text != 'Exit'){
										toEdit = $.message.text
										userInput['message'] = 'Enter new '+toEdit
										$.runMenu(userInput)
										$.waitForRequest.then($ => {
											var newEntry = []
											if($.message.text != 'Exit'){
												if(toEdit == 'Name')
													newEntry = [$.message.text,currAddbook[chosenAddressIndex][1]]
												else
													newEntry = [currAddbook[chosenAddressIndex][0],$.message.text]
												
												currAddbook.splice(chosenAddressIndex,1,newEntry)
												updateUserRecord(currUserID,"addressbook",currAddbook)
												mainMenu['message'] = "Edit Successful"
												$.runMenu(mainMenu)					
											} else {
												mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
												$.runMenu(mainMenu)
											}									
										})
									} else {
										mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
										$.runMenu(mainMenu)
									}
								})
							} else {
								mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
								$.runMenu(mainMenu)
							}
						})
					} else if ($.message.text == 'Add'){
						var addAddress = ""
						var addName = ""
						userInput['message'] = 'Enter the Address'
						$.runMenu(userInput)
						$.waitForRequest.then($ => {
							if($.message.text != 'Exit'){
								addAddress = $.message.text
								if(nem.model.address.isValid(addAddress)){		//DONE: validate address here
									userInput['message'] = 'Enter the Name'	
									$.runMenu(userInput)
									$.waitForRequest.then($ => {
										if($.message.text != 'Exit'){
											addName = $.message.text 
											//ADD address to user record
											console.log("ADD! Address: "+addAddress+" Name: "+addName)
											currAddbook.push([addName,addAddress])
											updateUserRecord(currUserID,"addressbook",currAddbook)
											mainMenu['message'] = "Address Added!"
											$.runMenu(mainMenu)	
										}			
									})
								} else {
									mainMenu['message'] = "Address Not Valid"
									$.runMenu(mainMenu)	
								}
								
							} else {
								mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
								$.runMenu(mainMenu)
							}
						})
					}else {
						mainMenu['message'] = "<b>Nem Wallet Telegram Bot</b>"
						$.runMenu(mainMenu)
					}
				})
			} else {
				mainMenu['message'] = "You don't have a wallet yet.\nChoose Create/Check Wallet to create one."
				$.runMenu(mainMenu)
			}
		})
    }
    get routes() {
        return {
            'addressbookCommand': 'addressbookHandler'
        }
    }
}

    /* Menus */
	
var defaultMenuFunction = function(index){return index.update.message.text}

var mainMenu = {
    options: {
        parse_mode: 'HTML' // in options field you can pass some additional data, like parse_mode
    },
	oneTimeKeyboard: true,
	'Create/Check Wallet': new WalletController().walletHandler,
	'Check Balance': new BalanceController().balanceHandler,
	'Send Transaction': new sendController().sendHandler,
	'Address Book': new addressbookController().addressbookHandler,
	'Help': new HelpController().helpHandler,

}

var userConfirm = { 
    options: {
        parse_mode: 'HTML'
    },
	oneTimeKeyboard: true,
	'yes': defaultMenuFunction,
	'no': defaultMenuFunction,
}

var userInput = {
    options: {
        parse_mode: 'HTML'
    },
	oneTimeKeyboard: true,
	'Exit': defaultMenuFunction,
}

var addressbookItem = {
    options: {
        parse_mode: 'HTML'
    },
	oneTimeKeyboard: true,
	'Edit Entry': defaultMenuFunction,
	'Delete Entry': defaultMenuFunction,
	'Exit': defaultMenuFunction,
}

var editAddress = {
    options: {
        parse_mode: 'HTML'
    },
	oneTimeKeyboard: true,
	'Name': defaultMenuFunction,
	'Address': defaultMenuFunction,
	'Exit': defaultMenuFunction,
}

    /* Interval for updates */

tg.onMaster(() => {
	setInterval(checkAccounts, config.intervalTime*1000) //seconds
})

    /* listening for commands */

tg.router
/*	.when(new TextCommand('/Balance','balanceCommand'), new BalanceController())
	.when(new TextCommand('Check Balance','balanceCommand'), new BalanceController())
	.when(new TextCommand('/Wallet','walletCommand'), new WalletController())
	.when(new TextCommand('Create/Check Wallet','walletCommand'), new WalletController())
	.when(new TextCommand('/Send', 'sendCommand'), new sendController())
	.when(new TextCommand('Send Transaction', 'sendCommand'), new sendController())
	.when(new TextCommand('/Addressbook', 'addressbookCommand'), new addressbookController())
	.when(new TextCommand('Address Book', 'addressbookCommand'), new addressbookController())
	.when(new TextCommand('/Help', 'helpCommand'), new HelpController())*/
	
	
	.when(new TextCommand('/start', 'helpCommand'), new HelpController())
	.otherwise(new OtherwiseController())

	
	/* Test Cases */

if(false){
	var list = []
	fs.readdir(recordPath, (err, files) => {
		var updateCount = 0
		if(!files) return	
		
		files.forEach(file => {
			if(file.split('.')[1] == "json"){
				var currUserID = file.split('.')[0]
				getUserRecord(currUserID,function(res){
					if(res[0].addressbook == undefined){
						console.log(res[0].addressbook)
						res[0].addressbook = []
						updateUserRecord(currUserID,"addressbook",res[0].addressbook)
						updateCount++
					}	
				})
			}
		console.log("Succesfully updated "+updateCount+" accounts")
		})
	})
	
}
if(false){
	var mainobject = {}

	getUserRecord("481591309",function(res){		
		if(!res[0].addressbook)
			res[0].addressbook = []
	
		console.log(res)
	})
	
}
if(false){
	var mainobject = {}

	getUserRecord("481591309",function(res){		
		res[0].addressbook.forEach(function(address){
			console.log(address[0].indexOf("1_Name"))
		})
	})
}
if(false){
	var tempObject = {}
	var mainobject = []
	
	for(var i = 0;i < 3; i++){
		var name = i+"_Name"
		var add = i+"_NADNDJYUPKJTUQ6F4E7XXOOURHJ4NUEXCZQZPEBA_"
		mainobject.push([name,add])
	}
	
	updateUserRecord("481591309","addressbook",mainobject)
	
}
if(false){	
	var	userUsername = "isaganiesteron"
	var	userID = "481591309"
	var	userWalletName = "Ganistestwallet1"
	var	userPass = "Password1"
	
	console.log(getAccountKey(userID+"_"+userUsername+"_"+userWalletName+"_"+userPass))
}
if(false){
	var curp = "25658197"
	console.log(schema.validate(curp))
}

if(false){
	let user = {
		userUsername: "isaganiesteron",
		userID: "481591309",
		userWalletName: "Ganistestwallet2",
		userPass:"Password1",
	}
	let transaction = {
	//	transMosaic: "isaganiesteron:faux_lyl",
		transMosaic: "nem:xem",
		transAddress: "TD4J44-YRXADA-ZFKG5M-3LE4AO-AEJVKE-JZEJRU-7JMV",
		transAmount: 1,
		transMessage: "The New Economy Movement will change the world!!!",	
	}

	sendTransaction({user,transaction}, function(res){
		console.log(res)
	})
}
if(false){
	//function getMosaicFees(supply,divisibility,amount){

	console.log(getTransactionFees("xem",45000))
	console.log(getTransactionFees("xem",500000))
}

if(false){
	//function getMosaicFees(supply,divisibility,amount){
		
	console.log(getMosaicFees(9000000,3,150))
	console.log(getMosaicFees(9000000000,6,1))
}

//private keys that work: 1,2,3,asdf,abc
if(false){
	createAccountWallet({wName:"ganistelegramnemwallet",id:"481591309",username:"isaganiesteron",pass:"Password1"},function(res){
		console.log(res)
	})
}

if(false){
	//updates user account data
	getAccountData("NADNDJYUPKJTUQ6F4E7XXOOURHJ4NUEXCZQZPEBA", function(res){
		console.log(res)
		console.log(updateUserRecord("481591309","data",res))
	})
}
if(false){
	//updates user mosaics owned
	getAccountMosaics("TAZB6W5B5RTJJA5XOGXLHOE24JUY35CTR3A3TEKG", function(res){
		console.log(updateUserRecord("481591309","mosaics",res[0]))
	})
}

if(false){
	console.log(schema.validate("sdf", { list: true }).length)
	console.log(schema.validate("122345X7x", { list: true }).length)
}

if(false){
	nem.com.requests.account.data(endpoint, "NDHQW32SNSGECFE2ICLDCF5FULCOK2CXTXQRZ2NA").then(function(res) {
		console.log(res)
	}, function(err) {
		console.log(err.data.message)
	})
}
