var TokenStore = artifacts.require("./TokenStore.sol");
//var AccountModifiers = artifacts.require("./AccountModifiers.sol");
var InstantTrade = artifacts.require("./InstantTrade.sol");
var Token = artifacts.require("./InstantTradeContracts/EIP20.sol");
var EtherDelta = artifacts.require("./InstantTradeContracts/EtherDelta.sol");
var WETH = artifacts.require("./InstantTradeContracts/0x/WETH9.sol");
var ZeroX = artifacts.require("./InstantTradeContracts/0x/Exchange.sol");
var ZeroProxy = artifacts.require("./InstantTradeContracts/0x/TokenTransferProxy.sol");
var ZRXToken = artifacts.require("./InstantTradeContracts/0x/ZRXToken.sol");

var util_abi = require('ethereumjs-abi');
var util = require('ethereumjs-util');
//var util = require('./util.js');
//var async = require('async');
var config = require('../truffle-config.js');

contract("InstantTrade", function (accounts) {

  const feeAccount = accounts[0];
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const fee = 3000000000000000;
  const userToken = 2000000;
  const depositedToken = userToken / 4;
  const depositedEther = 100000;
  const defaultExpirationInBlocks = 100;
  const gasPrice = config.networks.development.gasPrice;

  var tokenStore, instantTrade, token, etherDelta, wETH, zeroX, zeroProxy, zrxToken;

  before(async function () {
    /* Deployed in migrations by accounts[0] */
    tokenStore = await TokenStore.deployed();
    token = await Token.deployed();


    /* Deploy new EtherDelta instance */
    etherDelta = await EtherDelta.new(feeAccount, feeAccount, zeroAddress, 0, fee, 0, { from: feeAccount });
    /* Deploy 0x contracts */
    wETH = await WETH.new({ from: feeAccount });
    zrxToken = await ZRXToken.new({ from: feeAccount });
    zeroProxy = await ZeroProxy.new({ from: feeAccount });
    zeroX = await ZeroX.new(zrxToken.address, zeroProxy.address, { from: feeAccount });
    instantTrade = await InstantTrade.new(wETH.address, zeroX.address, { from: feeAccount });

    await zeroProxy.addAuthorizedAddress(zeroX.address, { from: feeAccount });
    await instantTrade.allowFallback(tokenStore.address, true, { from: feeAccount });
    await instantTrade.allowFallback(etherDelta.address, true, { from: feeAccount });


    /* Give accounts 1 to 4 some tokens, make them deposit both tokens and ether */
    for (let i = 1; i < 9; i++) {

      await token.transfer(accounts[i], userToken, { from: feeAccount });

      await token.approve(etherDelta.address, depositedToken, { from: accounts[i] });
      await etherDelta.depositToken(token.address, depositedToken, { from: accounts[i] });
      await etherDelta.deposit({ from: accounts[i], value: depositedEther });

      //    await token.approve(tokenStore.address, depositedToken, { from: accounts[i] });
      //    await tokenStore.depositToken(token.address, depositedToken, { from: accounts[i] });
      //    await tokenStore.deposit({ from: accounts[i], value: depositedEther });
    }

  });


  function signOrder(exchangeAddress, maker, tokenGet, amountGet, tokenGive, amountGive, expires, nonce) {

    let values = [exchangeAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce];
    let types = ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"];

    const hash = `0x${util_abi.soliditySHA256(types, values).toString('hex')}`;

    let sigResult = web3.eth.sign(maker, hash);

    let sig = util.fromRpcSig(sigResult);
    sig.r = `0x${sig.r.toString('hex')}`
    sig.s = `0x${sig.s.toString('hex')}`
    sig.hash = hash;
    return sig;


  }

  function sign0xOrder(exchangeAddress, orderAddresses, orderValues, hash) {

    let values = [exchangeAddress, orderAddresses[0], orderAddresses[1], orderAddresses[2], orderAddresses[3], orderAddresses[4],
      orderValues[0], orderValues[1], orderValues[2], orderValues[3], orderValues[4], orderValues[5]
    ];
    let types = ["address", "address", "address", "address", "address", "address",
      "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"
    ];

    //hash = `0x${util_abi.soliditySHA256(types, values).toString('hex')}`;

    let sigResult = web3.eth.sign(orderAddresses[0], hash);

    let sig = util.fromRpcSig(sigResult);
    sig.r = `0x${sig.r.toString('hex')}`
    sig.s = `0x${sig.s.toString('hex')}`
    sig.hash = hash;
    return sig;
  }

  it("Sell tokens EtherDelta", async function () {

    let exchangeAddress = etherDelta.address;
    let tokenGet = token.address;
    let amountGet = depositedToken / 4;
    let amountGive = depositedEther / 4;
    let tokenGive = zeroAddress;
    let expires = web3.eth.blockNumber + defaultExpirationInBlocks;
    let nonce = 1;
    let maker = accounts[1];
    let taker = accounts[2];

    let order = signOrder(exchangeAddress, maker, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);

    /* check if the order is valid in the contract */
    let unfilled = await etherDelta.availableVolume(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s);
    assert.equal(String(unfilled), String(amountGet), "Order is available");


    let amountFee = (amountGet * 1.004); //add 0.4%

    await token.approve(instantTrade.address, amountFee, { from: taker });

    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    //let trade = await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker });
    let trade = await instantTrade.sellTokens(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.plus(amountGive).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.minus(amountFee)), "Token balance normal");

  });


  it("Buy tokens EtherDelta", async function () {

    let exchangeAddress = etherDelta.address;
    let tokenGet = zeroAddress;
    let amountGet = depositedEther / 4;
    let amountGive = depositedToken / 4;
    let tokenGive = token.address;
    let expires = web3.eth.blockNumber + defaultExpirationInBlocks;
    let nonce = 2;
    let maker = accounts[3];
    let taker = accounts[4];

    let order = signOrder(exchangeAddress, maker, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);

    /* check if the order is valid in the contract */
    let unfilled = await etherDelta.availableVolume(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s);
    assert.equal(String(unfilled), String(amountGet), "Order is available");


    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let amountFee = (amountGet * 1.004); //add 0.4%

    //let trade = await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker, value: amountFee });
    let trade = await instantTrade.buyTokens(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker, value: amountFee });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.minus(amountFee).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.plus(amountGive)), "Token balance normal");

  });



  it('Buy tokens 0x', async function () {

    let taker = accounts[6];
    let maker = accounts[5];

    let orderAddresses = [
      maker, // maker
      zeroAddress, // taker
      token.address, // makerToken
      wETH.address, // takerToken
      zeroAddress, // feeRecipient
    ];
    let orderValues = [
      depositedToken / 4, // makerTokenAmount
      depositedEther / 4,// takerTokenAmount
      0, // maker fee
      0, // taker fee
      2524636800, // expiration timestamp in seconds
      3, // salt
    ];

    await token.approve(zeroProxy.address, orderValues[0], { from: maker });

    let hash = await zeroX.getOrderHash(orderAddresses, orderValues);
    let order = sign0xOrder(zeroX.address, orderAddresses, orderValues, hash);

    /* check if the order is valid in the contract */
    assert.equal(hash, order.hash, 'hashes are equal');
    let valid = await zeroX.isValidSignature(maker, hash, order.v, order.r, order.s);
    assert(valid, 'order is valid');
    let filled = await zeroX.getUnavailableTakerTokenAmount(hash);
    assert.equal(String(filled), "0", "Order is available");


    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let allowedMaker = await token.allowance(maker, zeroProxy.address);
    assert.equal(String(allowedMaker), String(orderValues[0]), 'maker allowance');

    let amountFee = (orderValues[1] * 1.004); //add 0.4%

    //let trade = await instantTrade.instantTrade0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker, value: amountFee });
    let trade = await instantTrade.buyTokens0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker, value: amountFee });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.minus(amountFee).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.plus(orderValues[0])), "Token balance normal");
  });

  it('Sell tokens 0x', async function () {
    let taker = accounts[8];
    let maker = accounts[7];

    let orderAddresses = [
      maker, // maker
      zeroAddress, // taker
      wETH.address, // makerToken
      token.address, // takerToken
      zeroAddress, // feeRecipient
    ];
    let orderValues = [
      depositedEther / 4, // makerTokenAmount
      depositedToken / 4,// takerTokenAmount
      0, // maker fee
      0, // taker fee
      2524636800, // expiration timestamp in seconds
      4, // salt
    ];

    await wETH.deposit({ from: maker, value: orderValues[0] });
    await wETH.approve(zeroProxy.address, orderValues[0], { from: maker });


    let hash = await zeroX.getOrderHash(orderAddresses, orderValues);
    let order = sign0xOrder(zeroX.address, orderAddresses, orderValues, hash);

    /* check if the order is valid in the contract */
    assert.equal(hash, order.hash, 'hashes are equal');
    let valid = await zeroX.isValidSignature(maker, hash, order.v, order.r, order.s);
    assert(valid, 'order is valid');
    let filled = await zeroX.getUnavailableTakerTokenAmount(hash);
    assert.equal(String(filled), "0", "Order is available");


    let amountFee = (orderValues[1] * 1.004); //add 0.4%
    await token.approve(instantTrade.address, amountFee, { from: taker });

    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let allowedMaker = await wETH.allowance(maker, zeroProxy.address);
    assert.equal(String(allowedMaker), String(orderValues[0]), 'maker allowance');
    let allowedTaker = await token.allowance(taker, instantTrade.address);
    assert.equal(String(allowedTaker), String(amountFee), 'taker allowance');

    //let trade = await instantTrade.instantTrade0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker });
    let trade = await instantTrade.sellTokens0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.plus(orderValues[0]).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.minus(amountFee)), "Token balance normal");
  });

}); 