const bitcoin = require('bitcoinjs-lib')
const request = require('request-promise-native')
var express = require('express');
var bodyParser = require('body-parser');
var url = require('url');
var router = express.Router();
var app = express();

app.use(bodyParser.urlencoded({ extended: false })); 

const log4js = require('log4js');
log4js.configure({
  appenders: { 
	normal: { 
		type: 'file', 
		filename: "/root/omniwallet/logs/file.log",
		maxLogSize: 1024*1024*1,
		backups: 100		
	} },
  categories: { 
	default: { 
		appenders: ['normal'], 
		level: 'info' 
	} }
});

const logger = log4js.getLogger('normal');

const net = bitcoin.networks.bitcoin
  // bitcoin.networks.testnet
  // bitcoin.networks.bitcoin
var AesKey = "";

const API = net === bitcoin.networks.testnet
  ? `https://test-insight.swap.online/insight-api`
  : `http://47.52.197.198:3001/insight-api`
  //: `https://insight.bitpay.com/api`

//手续费  固定5000聪
const feeDefault      = 5000
  
const fetchUnspents = (address) =>
  request(`${API}/addr/${address}/utxo/`).then(JSON.parse)

const broadcastTx = (txRaw) =>
  request.post(`${API}/tx/send`, {
    json: true,
    body: {
      rawtx: txRaw,
    },
 })
  
const getBalance = (address) =>
  request.post(`https://api.omniexplorer.info/v1/address/addr/`, {
    json: false,
	headers: {
            "content-type": "application/x-www-form-urlencoded",
        },	
	formData: { addr: address}    
  })  
  
//生成交易
const createSimpleSend = async (fetchUnspents, alice_pair, send_address, recipient_address, amount, feeValue) => {
  //构建txBuilder
  const txBuilder = new bitcoin.TransactionBuilder(net)
  //获取未花费的交易
  const unspents = await fetchUnspents(send_address)  
  //最低交易546聪
  const fundValue     = 546 // dust
  //获取inputs
  var totalUnspent = 0
  const outputsNum = 3
  //遍历未花费交易列表，生成交易输入项
  console.log((new Date()).toLocaleString(),"未花费记录条数：", unspents.length)
  for (var i=0; i< unspents.length; i++){
	//if (unspents[i].confirmations < 6) {
	//	console.log("tx: ",unspents[i].txid,"confirmations: ", unspents[i].confirmations)
	//	continue
	//}
	totalUnspent = totalUnspent +  unspents[i].satoshis
	txBuilder.addInput(unspents[i].txid,  unspents[i].vout, 0xfffffffe)
	console.log("tx:",unspents[i].txid,"satoshis:",unspents[i].satoshis,"confirmations:", unspents[i].confirmations)
	//feeValue = (i+1) * 180 + outputsNum * 34 + 10 + 40 //暂时没有实时计算手续费，固定5000聪
	//如果当前未花费交易金额已经大于 最低交易*2+手续费，跳出循环 
	//减去两次最低交易是因为找零余额也必须大于最低交易费 不然会被比特币网络限制
	if (totalUnspent > feeValue + fundValue + fundValue){
		break
	}
  }  
  //判断未花费交易金额是否足够，不足抛出异常
  if (totalUnspent < feeValue + fundValue + fundValue) {
	//console.log((new Date()).toLocaleString(),`Total less than fee: ${totalUnspent} < ${feeValue} + ${fundValue}`)
    throw new Error(`BTC余额不足以支付手续费`)
  }  
  //计算剩余金额
  const skipValue     = totalUnspent - fundValue - feeValue	
  logger.info("totalUnspent:"+totalUnspent.toString(10)+" feeValue:"+feeValue.toString(10)+" fundValue:"+fundValue.toString(10)+" skipValue:"+skipValue.toString(10))
  console.log("totalUnspent:"+totalUnspent.toString(10)+" feeValue:"+feeValue.toString(10)+" fundValue:"+fundValue.toString(10)+" skipValue:"+skipValue.toString(10))
  //构建USDT交易	
  const simple_send = [
    "6f6d6e69", // omni
    "0000",     // version
    "00000000001f", // 31 for Tether
    ("0000000000000000"+amount.toString(16)).substr(-16)
  ].join('')
  const data = Buffer.from(simple_send, "hex")
  const omniOutput = bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN,
    data
  ])
  //添加交易输出项
  txBuilder.addOutput(recipient_address, fundValue) // should be first!
  txBuilder.addOutput(omniOutput, 0)
  txBuilder.addOutput(send_address, skipValue)
  //签名输入项
  txBuilder.__tx.ins.forEach((input, index) => {
    txBuilder.sign(index, alice_pair)
  })
  return txBuilder
}

var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();  
app.post('/v2/wallet/usdt/sendto',multipartMiddleware, function (req, res, next) {	
	logger.info("客户端ip",get_client_ip(req),"转账Url",req.url)
	console.log("客户端ip",get_client_ip(req),"转账Url",req.url)		
	try{
		var data = req.body.key; 
		var datajson = decryption(data,AesKey);			
	}catch(err){
		logger.error('解密失败:', err.message)
		console.log((new Date()).toLocaleString(), "解密失败",err.message); 
		var json = {};
		json.msg = "格式错误"
		json.errcode = -4
		json.code = -4
		json.errorinfo = "格式错误:" + err.message
		res.end(JSON.stringify(json))	
		return			
	}
	try
	{	
		var obj = JSON.parse(datajson)	
		var privkey = obj.privkey
		var fromaddress = obj.fromaddress
		var toaddress = obj.toaddress			
		var amount = parseInt(obj.amount) 		
		if (amount <= 0){
			throw new Error(`amount:${amount} <= 0 `)
		}
	}catch(err){
		logger.error('金额非法:', err.message)
		console.log((new Date()).toLocaleString(), "金额非法",err.message); 
		var json = {};
		json.msg = "金额非法"
		json.errcode = -3
		json.code = -3
		json.errorinfo = "金额非法:" + err.message
		res.end(JSON.stringify(json))	
		return		
	}
		
	logger.info("转账从",fromaddress,"到",toaddress,amount);
	console.log((new Date()).toLocaleString(),"转账从",fromaddress,"到",toaddress,amount,fee);
	try {
	  bitcoin.address.fromBase58Check(fromaddress)
	} catch (e) {
		console.log("转出地址非法");
		var json = {};
		json.msg = "转出地址非法"
		json.errcode = -5
		json.code = -5
		res.end(JSON.stringify(json))
		return			
	}
	try {
	  bitcoin.address.fromBase58Check(toaddress)
	} catch (e) {
		console.log("转入地址非法");
		var json = {};
		json.msg = "转入地址非法"
		json.errcode = -6
		json.code = -6
		res.end(JSON.stringify(json))
		return			
	}	
	sendto(res,privkey,fromaddress,toaddress,amount,fee);
});

app.post('/wallet/usdt/sendto',multipartMiddleware, function (req, res, next) {		
	logger.info("客户端ip",get_client_ip(req),"转账Url",req.url)
	console.log("客户端ip",get_client_ip(req),"转账Url",req.url)		
	try
	{
		var privkey = req.body.privkey
		var fromaddress = req.body.fromaddress
		var toaddress = req.body.toaddress			
		var amount = parseInt(req.body.amount)
		if (amount <= 0){
			throw new Error(`amount:${amount} <= 0 `)
		}
		var fee = req.body.fee
		if (fee == "undefined"){
			fee = feeDefault
		}		
	}catch(err){
		logger.error('金额非法:', err.message)
		console.log((new Date()).toLocaleString(), "金额非法",err.message); 
		var json = {};
		json.msg = "金额非法"
		json.errcode = -3
		json.code = -3
		json.errorinfo = "金额非法:" + err.message
		res.end(JSON.stringify(json))	
		return		
	}
		
	logger.info("转账从",fromaddress,"到",toaddress,amount);
	console.log((new Date()).toLocaleString(),"转账从",fromaddress,"到",toaddress,amount,fee);
	try {
	  bitcoin.address.fromBase58Check(fromaddress)
	} catch (e) {
		console.log("转出地址非法");
		var json = {};
		json.msg = "转出地址非法"
		json.errcode = -5
		json.code = -5
		res.end(JSON.stringify(json))
		return			
	}
	try {
	  bitcoin.address.fromBase58Check(toaddress)
	} catch (e) {
		console.log("转入地址非法");
		var json = {};
		json.msg = "转入地址非法"
		json.errcode = -6
		json.code = -6
		res.end(JSON.stringify(json))
		return			
	}	
	sendto(res,privkey,fromaddress,toaddress,amount,fee);
});

app.get('/wallet/usdt/sendto', function (req, res, next) {	 
	logger.info("客户端ip",get_client_ip(req),"转账Url",req.url)
	console.log("客户端ip",get_client_ip(req),"转账Url",req.url)	
	try
	{
		var arg = url.parse(req.url, true).query; 
		var privkey = arg.privkey
		var fromaddress = arg.fromaddress
		var toaddress = arg.toaddress			
		var amount = parseInt(arg.amount) 	
		if (amount <= 0){
			throw new Error(`amount:${amount} <= 0 `)
		}
		var fee = arg.fee
	}catch(err){
		logger.error('金额非法:', err.message)
		console.log((new Date()).toLocaleString(), "金额非法",err.message); 
		var json = {};
		json.msg = "金额非法"
		json.errcode = -3
		json.code = -3
		json.errorinfo = "金额非法:" + err.message
		res.end(JSON.stringify(json))	
		return		
	}
	
	logger.info("转账从",fromaddress,"到",toaddress,amount);
	console.log((new Date()).toLocaleString(),"转账从",fromaddress,"到",toaddress,amount,fee);
	try {
	  bitcoin.address.fromBase58Check(fromaddress)
	} catch (e) {
		console.log("转出地址非法");
		var json = {};
		json.msg = "转出地址非法"
		json.errcode = -5
		json.code = -5
		res.end(JSON.stringify(json))
		return			
	}
	try {
	  bitcoin.address.fromBase58Check(toaddress)
	} catch (e) {
		console.log("转入地址非法");
		var json = {};
		json.msg = "转入地址非法"
		json.errcode = -6
		json.code = -6
		res.end(JSON.stringify(json))
		return			
	}		
	sendto(res,privkey,fromaddress,toaddress,amount,fee);
})

function sendto(res,privkey,fromaddress,toaddress,amount,fee){
	try{		
		var keyPair = bitcoin.ECPair.fromWIF(privkey, net)		
	}catch(err){
		logger.error('私钥格式有误:', err.message)
		console.log((new Date()).toLocaleString(), "私钥格式有误",err.message); 
		var json = {};
		json.msg = "私钥格式有误"
		json.errcode = -2
		json.code = -2
		json.errorinfo = "私钥格式有误:" + err.message
		res.end(JSON.stringify(json))	
		return		
	}
	
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey ,network: net})	
	if (address != fromaddress){
		logger.error("私钥和地址不匹配",privkey,fromaddress,address)
		console.log((new Date()).toLocaleString(), "私钥和地址不匹配",privkey,fromaddress,address); 
		var json = {};
		json.msg = "私钥错误"
		json.errcode = -2
		json.code = -2
		json.errorinfo = "私钥和地址不匹配"
		res.end(JSON.stringify(json))	
		return			
	}
	var feeValue = feeDefault
	if (fee != undefined){
		try{
			feeValue = parseInt(fee) 	
			if (feeValue <= 5000 || feeValue >= 1000000){
				feeValue = feeDefault
			}	
		}catch(err){
			feeValue = feeDefault
		}		
	}	
	try{
		// Construct tx	
		const omni_tx = createSimpleSend(fetchUnspents, keyPair, fromaddress, toaddress, amount, feeValue)		
		omni_tx.then(tx => {
			const txRaw = tx.buildIncomplete()
			logger.info("txRaw:",txRaw.toHex())
			var txResult = broadcastTx(txRaw.toHex())
			txResult.then(tx => {	 
				var json = {};
				json.errcode = 0
				json.code = 0				
				json.txid = tx.txid
				json.data = {}
				json.data.txid = tx.txid
				res.end(JSON.stringify(json))
				logger.info(tx)			
				console.log((new Date()).toLocaleString(),"交易成功:",json)	  
			})
			.catch( (err) => {
				logger.error('发送tx请求失败:', err.message)
				console.log((new Date()).toLocaleString(), "发送tx请求失败",err.message);     //网络请求失败返回的数据  
				var json = {};				
				json.errcode = -1
				json.code = -1
				json.msg = "交易失败"
				json.errorinfo = "发送tx请求失败:" + err.message
				res.end(JSON.stringify(json))
				return
			});	
		})
		.catch((err) => {
			logger.error('构建交易失败:', err.message)
			console.log((new Date()).toLocaleString(),'构建simplesend失败', err.message);     //网络请求失败返回的数据  	
			var json = {};			
			json.errcode = -1
			json.code = -1
			json.msg = "交易失败"
			json.errorinfo = "构建交易失败:" + err.message
			res.end(JSON.stringify(json))
			return
		});	
	}catch(err){
		logger.error('发生未知异常:', err.message)
		console.log((new Date()).toLocaleString(), "发生未知异常",err.message); 
		var json = {};
		json.msg = "交易失败"
		json.errcode = -1
		json.code = -1
		json.errorinfo = "发生未知异常:" + err.message
		res.end(JSON.stringify(json))	
		return		
	}	
}

app.get('/wallet/usdt/balance', function (req, res, next){
	logger.info("客户端ip",get_client_ip(req),"查询余额Url",req.url)
	console.log("客户端ip",get_client_ip(req),"查询余额Url",req.url)		
	var arg = url.parse(req.url, true).query; 
	var address = arg.address
	logger.info("查询余额,地址:",address)
	console.log((new Date()).toLocaleString(),"查询余额,地址:",address)
	try{
		var balanceResult = getBalance(address)
		balanceResult.then(balance =>{
			logger.debug(balance)
			var r = JSON.parse(balance)
			for (var i=0; i< r.balance.length; i++){
				if (r.balance[i].id == 31){				
					var json = {};
					json.amount = parseInt(r.balance[i].value)
					json.errcode = 0
					json.code = 0
					json.data = {}
					json.data.amount = parseInt(r.balance[i].value)
					res.end(JSON.stringify(json))
					console.log((new Date()).toLocaleString(),"余额:",json)
					return;
				}
			}
			var json = {};
			json.msg = "没有查询到记录"
			json.errcode = -1
			json.code = -1
			res.end(JSON.stringify(json))
		}).catch((err) => {
			logger.error('获取余额失败:', err.message)
			console.log((new Date()).toLocaleString(),"获取余额失败",err.message);     //网络请求失败返回的数据  
			var json = {};
			json.errcode = -1
			json.code = -1
			json.msg = "获取余额失败"
			res.end(JSON.stringify(json))
		});
	}catch(err){
		logger.error('请求获取余额异常:', err.message)
		console.log((new Date()).toLocaleString(),"请求获取余额异常",err.message);     //网络请求失败返回的数据  		
		var json = {};
		json.msg = "获取余额异常"
		json.errcode = -1
		json.code = -1
		res.end(JSON.stringify(json))			 
	}			
})

var crypto = require('crypto');

function encryption(data, key) {
    var iv = "";
    var clearEncoding = 'utf8';
    var cipherEncoding = 'base64';
    var cipherChunks = [];
    var cipher = crypto.createCipheriv('aes-128-ecb', key, iv);
    cipher.setAutoPadding(true);

    cipherChunks.push(cipher.update(data, clearEncoding, cipherEncoding));
    cipherChunks.push(cipher.final(cipherEncoding));

    return cipherChunks.join('');
}

function decryption(data, key) {
    var iv = "";
    var clearEncoding = 'utf8';
    var cipherEncoding = 'base64';
    var cipherChunks = [];
    var decipher = crypto.createDecipheriv('aes-128-ecb', key, iv);
    decipher.setAutoPadding(true);

    cipherChunks.push(decipher.update(data, cipherEncoding, clearEncoding));
    cipherChunks.push(decipher.final(clearEncoding));

    return cipherChunks.join('');
}

//获取url请求客户端ip
var get_client_ip = function(req) {
    var ip = req.headers['x-forwarded-for'] ||
        req.ip ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress || '';
    if(ip.split(',').length>0){
        ip = ip.split(',')[0]
    }
    return ip;
};

module.exports = router;

var port = 83;
var args = process.argv.splice(2)
if(args.length == 1){
	port = parseInt(args[0]);
}else if (args.length == 2){
	port = parseInt(args[0]);
	AesKey = args[1];
}

var server = app.listen(port, function () {   //监听端口
  var host = server.address().address
  var port = server.address().port
  console.log('Example app listening at http://%s:%s', host, port);
})
