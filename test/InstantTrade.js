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
    instantTrade = await InstantTrade.deployed();

    /* Deploy new EtherDelta instance */
    etherDelta = await EtherDelta.new(feeAccount, feeAccount, zeroAddress, 0, fee, 0, { from: feeAccount });
    /* Deploy 0x contracts */
    wETH = await WETH.new({ from: feeAccount });
    zrxToken = await ZRXToken.new({ from: feeAccount });
    zeroProxy = await ZeroProxy.new({ from: feeAccount });
    zeroX = await ZeroX.new(zrxToken.address, zeroProxy.address, { from: feeAccount });

    await zeroProxy.addAuthorizedAddress(zeroX.address, { from: feeAccount });

    /* Give accounts 1 to 4 some tokens, make them deposit both tokens and ether */
    for (let i = 1; i < 5; i++) {

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

    let trade = await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker });
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

    let trade = await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker, value: amountFee });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.minus(amountFee).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.plus(amountGive)), "Token balance normal");

  });

}); 