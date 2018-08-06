var TokenStore = artifacts.require("./TokenStore.sol");
//var AccountModifiers = artifacts.require("./AccountModifiers.sol");
var InstantTrade = artifacts.require("./InstantTrade.sol");
var Token = artifacts.require("./InstantTradeContracts/EIP20.sol");
var EtherDelta = artifacts.require("./InstantTradeContracts/EtherDelta.sol");
var WETH = artifacts.require("./InstantTradeContracts/0x/WETH9.sol");
var ZeroX = artifacts.require("./InstantTradeContracts/0x/Exchange.sol");
var ZeroProxy = artifacts.require("./InstantTradeContracts/0x/TokenTransferProxy.sol");
var ZRXToken = artifacts.require("./InstantTradeContracts/0x/ZRXToken.sol");

var util = require('./util.js');
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
  const revertError = "VM Exception while processing transaction: revert";

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

    // check onlyOwner modifier
    try {
      await instantTrade.allowFallback(etherDelta.address, true, { from: accounts[1] });
      assert(false, "Only onwer can do this");
    } catch (error) {
      assert.equal(error.message, revertError);
    }


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
    return util.signOrder(web3, exchangeAddress, maker, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);
  }

  function sign0xOrder(exchangeAddress, orderAddresses, orderValues) {
    return util.sign0xOrder(web3, exchangeAddress, orderAddresses, orderValues);
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
    let unfilled = await instantTrade.availableVolume(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, etherDelta.address);
    assert.equal(String(unfilled), String(amountGet), "Order is available");


    let amountFee = (amountGet * 1.004); //add 0.4%

    await token.approve(instantTrade.address, amountFee, { from: taker });

    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let trade = await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.plus(amountGive).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.minus(amountFee)), "Token balance normal");


    try {
      await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker });
      assert(false, "Order can't be filled twice");
    } catch (error) {
      assert.equal(error.message, revertError);
    }

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
    let unfilled = await instantTrade.availableVolume(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, etherDelta.address);
    assert.equal(String(unfilled), String(amountGet), "Order is available");


    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let amountFee = (amountGet * 1.004); //add 0.4%

    let trade = await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker, value: amountFee });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.minus(amountFee).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.plus(amountGive)), "Token balance normal");

    try {
      await instantTrade.instantTrade(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, maker, order.v, order.r, order.s, amountGet, exchangeAddress, { from: taker, value: amountFee });
      assert(false, "Order can't be filled twice");
    } catch (error) {
      assert.equal(error.message, revertError);
    }

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

    let order = sign0xOrder(zeroX.address, orderAddresses, orderValues);

    /* check if the order is valid in the contract */
    let unfilled = await instantTrade.availableVolume0x(orderAddresses, orderValues, order.v, order.r, order.s);
    assert.equal(String(unfilled), String(orderValues[1]), "Order is available");


    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let allowedMaker = await token.allowance(maker, zeroProxy.address);
    assert.equal(String(allowedMaker), String(orderValues[0]), 'maker allowance');

    let amountFee = (orderValues[1] * 1.004); //add 0.4%

    let trade = await instantTrade.instantTrade0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker, value: amountFee });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.minus(amountFee).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.plus(orderValues[0])), "Token balance normal");

    try {
      await instantTrade.instantTrade0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker, value: amountFee });
      assert(false, "Order can't be filled twice");
    } catch (error) {
      assert.equal(error.message, revertError);
    }
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

    let order = sign0xOrder(zeroX.address, orderAddresses, orderValues);

    /* check if the order is valid in the contract */
    let unfilled = await instantTrade.availableVolume0x(orderAddresses, orderValues, order.v, order.r, order.s);
    assert.equal(String(unfilled), String(orderValues[1]), "Order is available");


    let amountFee = (orderValues[1] * 1.004); //add 0.4%
    await token.approve(instantTrade.address, amountFee, { from: taker });

    let etherBalance = await web3.eth.getBalance(taker);
    let tokenBalance = await token.balanceOf(taker);

    let allowedMaker = await wETH.allowance(maker, zeroProxy.address);
    assert.equal(String(allowedMaker), String(orderValues[0]), 'maker allowance');
    let allowedTaker = await token.allowance(taker, instantTrade.address);
    assert.equal(String(allowedTaker), String(amountFee), 'taker allowance');

    let trade = await instantTrade.instantTrade0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker });
    let gas = trade.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(taker)), String(etherBalance.plus(orderValues[0]).minus(gas)), "Ether balance normal");
    assert.equal(String(await token.balanceOf(taker)), String(tokenBalance.minus(amountFee)), "Token balance normal");

    try {
      await instantTrade.instantTrade0x(orderAddresses, orderValues, order.v, order.r, order.s, orderValues[1], { from: taker });
      assert(false, "Order can't be filled twice");
    } catch (error) {
      assert.equal(error.message, revertError);
    }
  });

  it("Random ETH transfers fail", async function () {

    try {
      await web3.eth.sendTransaction({ from: accounts[1], to: instantTrade.address, value: 100 });
      assert(false, "Fallback should reject this");
    } catch (error) {
      assert.equal(error.message, revertError);
    }
  });


  it("Withdraw Store ETH balance", async function () {

    let contractBalance = await web3.eth.getBalance(instantTrade.address);
    let storeBalance = await etherDelta.balanceOf(zeroAddress, instantTrade.address);

    assert(storeBalance.greaterThan(0));

    try {
      await instantTrade.withdrawStore(zeroAddress, etherDelta.address, { from: accounts[1] });
      assert(false, "Only allow withdraw from owner");
    } catch (error) {
      assert.equal(error.message, revertError);
    }

    await instantTrade.withdrawStore(zeroAddress, etherDelta.address, { from: feeAccount });

    assert.equal(String(await web3.eth.getBalance(instantTrade.address)), String(contractBalance.plus(storeBalance)), "ETH withdrawn");
    assert.equal(String(await await etherDelta.balanceOf(zeroAddress, instantTrade.address)), "0", "Store is empty");
  });

  it("Withdraw Token fees", async function () {

    let adminBalance = await token.balanceOf(feeAccount);
    let contractBalance = await token.balanceOf(instantTrade.address);

    try {
      await instantTrade.withdrawFees(token.address, { from: accounts[1] });
      assert(false, "Only allow withdraw from owner");
    } catch (error) {
      assert.equal(error.message, revertError);
    }

    let withdraw = await instantTrade.withdrawFees(token.address, { from: feeAccount });
    let gas = withdraw.receipt.gasUsed * gasPrice;

    assert.equal(String(await token.balanceOf(feeAccount)), String(adminBalance.plus(contractBalance)), "Tokens withdrawn");
    assert.equal(String(await token.balanceOf(instantTrade.address)), "0", "Contract is empty");
  });

  it("Withdraw ETH fees", async function () {

    let adminBalance = await web3.eth.getBalance(feeAccount);
    let contractBalance = await web3.eth.getBalance(instantTrade.address);

    try {
      await instantTrade.withdrawFees(zeroAddress, { from: accounts[1] });
      assert(false, "Only allow withdraw from owner");
    } catch (error) {
      assert.equal(error.message, revertError);
    }

    let withdraw = await instantTrade.withdrawFees(zeroAddress, { from: feeAccount });
    let gas = withdraw.receipt.gasUsed * gasPrice;

    assert.equal(String(await web3.eth.getBalance(feeAccount)), String(adminBalance.plus(contractBalance).minus(gas)), "Tokens withdrawn");
    assert.equal(String(await web3.eth.getBalance(instantTrade.address)), "0", "Contract is empty");
  });

}); 