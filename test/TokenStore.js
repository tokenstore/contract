var TokenStore = artifacts.require("./TokenStore.sol");
var AccountModifiers = artifacts.require("./AccountModifiers.sol");
var Token = artifacts.require("./InstantTradeContracts/EIP20.sol"); 
// use EIP20 for Token instead of TokenTemplate.sol to avoid issues with compilers >= 0.4.22

var util = require('./util.js');
var config = require('../truffle-config.js');

contract('TokenStore', function (accounts) {

  var unlockedAccounts = 5;
  var accs = accounts.slice(0, unlockedAccounts - 1); // Last account is used for fees only
  const gasPrice = config.networks.development.gasPrice;
  const feeAccount = unlockedAccounts - 1;
  const fee = 3000000000000000;
  const userToken = 2000000;
  const depositedEther = 100000;
  const depositedToken = 1000000;
  const defaultExpirationInBlocks = 100;
  const revertTransactionError = "VM Exception while processing transaction: revert";
  const opcodeTransactionError = "VM Exception while processing transaction: invalid opcode";



  var token1, token2, dec;

  beforeEach('setup tokens and balances for each test', async function () {
    dec = await TokenStore.new(fee, 0, { from: accounts[feeAccount] });
    token1 = await Token.new(userToken * accounts.length, "TestToken", 3, "TT1", { from: accounts[feeAccount] });
    token2 = await Token.new(userToken * accounts.length, "TestToken", 3, "TT2", { from: accounts[feeAccount] });

    for (let i = 0; i < unlockedAccounts; i++) {
      // Distribute tokens to all accounts
      await token1.transfer(accounts[i], userToken, { from: accounts[feeAccount] });

      //Deposit tokens for all accounts
      await token1.approve(dec.address, depositedToken, { from: accounts[i] });
      await dec.depositToken(token1.address, depositedToken, { from: accounts[i] });

      await token2.transfer(accounts[i], userToken, { from: accounts[feeAccount] });

      await token2.approve(dec.address, depositedToken, { from: accounts[i] });
      await dec.depositToken(token2.address, depositedToken, { from: accounts[i] });
    }

    for (let i = 0; i < accs.length; i++) {
      //Deposit ether for all accounts (besides feeAccount)
      await dec.deposit({ from: accs[i], value: depositedEther });
    }
  });


  ///////////////////////////////////////////////////////////////////////////////////
  // Helper functions
  ///////////////////////////////////////////////////////////////////////////////////


  function getBlockNumber() {
    return Number(web3.eth.blockNumber);
  }

  async function getAccountBalance(account) {
    return await web3.eth.getBalance(account);
  }


  function signOrder(exchangeAddress, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce) {

    return util.signOrder(web3, exchangeAddress, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);
  }

  //Place and trade an order  (last 3 params can be optional/undefined)
  async function executeOrder(dec, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, amountGiven, from, expire, nonce, expectedError) {

    var realNonce = nonce || Math.floor(Math.random());
    var blockNumber = getBlockNumber();
    var realExpire = expire || blockNumber + defaultExpirationInBlocks;

    let order = signOrder(dec.address, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, realExpire, realNonce);

    if (expectedError) {
      try {
        await dec.trade(tokenGet, amountGet, tokenGive, amountGive, realExpire,
          realNonce, creatorAddress, order.v, order.r, order.s, amountGiven, { from: from });
        return true;
      } catch (error) {
        assert.equal(error.message, expectedError, 'Valid error code for trade');
        return false;
      }
    } else {
      await dec.trade(tokenGet, amountGet, tokenGive, amountGive, realExpire,
        realNonce, creatorAddress, order.v, order.r, order.s, amountGiven, { from: from });
      return true;
    }
  }


  ///////////////////////////////////////////////////////////////////////////////////
  // Tests functions
  ///////////////////////////////////////////////////////////////////////////////////

  it("Depositing", async function () {

    /* Deposits made in beforeEach, check the result here */

    let result = await dec.balanceOf(token1.address, accounts[0]);
    assert.equal(result.toString(), depositedToken.toString(), "Token #1 deposit for acc #0 was not successful");

    result = await dec.balanceOf(token2.address, accounts[0]);
    assert.equal(result.toString(), depositedToken.toString(), "Token #2 deposit for acc #0 was not successful");

    result = await dec.balanceOf(0, accounts[0]);
    assert.equal(result.toString(), depositedEther.toString(), "Ether deposit for acc #0 was not successful");

    result = await dec.balanceOf(token1.address, accounts[1]);
    assert.equal(result.toString(), depositedToken.toString(), "Token #1 deposit for acc #1 was not successful");

    result = await dec.balanceOf(token2.address, accounts[1]);
    assert.equal(result.toString(), depositedToken.toString(), "Token #2 deposit for acc #1 was not successful");

    result = await dec.balanceOf(0, accounts[1]);
    assert.equal(result.toString(), depositedEther.toString(), "Ether deposit for acc #1 was not successful");

    result = await dec.fee();
    assert.equal(result.toString(), fee.toString(), "The fee is incorrect");
  });


  it("Withdrawals", async function () {

    var userEther;
    var gasSpent = web3.toBigNumber(0); // We will need it to get precise remaining ether amount, bignumber to avoid rounding issues

    var result = await getAccountBalance(accounts[0]);
    userEther = result;
    result = await token1.balanceOf(accounts[0]);
    assert.equal(result.toString(), (userToken - depositedToken).toString(), "Token #1 deposit for acc #0 is not correct");


    result = await dec.withdraw(depositedEther, { from: accounts[0] });
    gasSpent = gasSpent.plus(result.receipt.gasUsed);
    result = await dec.withdrawToken(token1.address, depositedToken, { from: accounts[0] });
    gasSpent = gasSpent.plus(result.receipt.gasUsed);


    result = await getAccountBalance(accounts[0]);
    assert.equal(result.toString(), userEther.plus(depositedEther).minus(gasSpent.times(gasPrice)).toString(), "Ether balance was not increased");

    result = await token1.balanceOf(accounts[0]);
    assert.equal(result.toString(), userToken.toString(), "Token #1 balance is not increased");

    result = await dec.balanceOf(0, accounts[0]);
    assert.equal(result.toString(), "0", "Exchange still thinks it holds some ether for the user");

    result = await dec.balanceOf(token1.address, accounts[0]);
    assert.equal(result.toString(), "0", "Exchange still thinks it holds some tokens for the user");

  });


  // Note: this tests only Eth to Token but since we treat eth internally
  // as a token with 0 address, direction is not important. It can also be
  // Token to Token for that matter.
  it("Successful trade", async function () {

    var tokenGet = 0;       // Eth as a token type
    var tokenGive = token1.address; // Token address for wanted token
    var amountGet = 20000;   // Eth wanted
    var amountGive = 100000; // Token given in return
    var amountGiven = 10000; // Ether given by a counter-party

    await executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven, accounts[1]);

    var result = await dec.balanceOf(tokenGive, accounts[0])
    assert.equal(result.toString(), "950000", "Token sale for acc #0 was not successful");

    result = await dec.balanceOf(tokenGive, accounts[1])
    assert.equal(result.toString(), "1050000", "Token purchase for acc #1 was not successful");

    result = await dec.balanceOf(tokenGet, accounts[0])
    assert.equal(result.toString(), "110000", "Eth purchase for acc #0 was not successful");

    result = await dec.balanceOf(tokenGet, accounts[1])
    assert.equal(result.toString(), "89970", "Eth sale for acc #1 was not successful");

    result = await dec.balanceOf(tokenGet, accounts[feeAccount])
    assert.equal(result.toNumber().valueOf(), 30, "Eth fee is incorrect");
  });


  it("Account modifiers", async function () {

    var accountModifiers = await AccountModifiers.new({ from: accounts[feeAccount] });

    var tokenGet = 0;       // Eth as a token type
    var tokenGive = token1.address;          // Token address for wanted token
    var amountGet = 20000;   // Eth wanted
    var amountGive = 100000; // Token given in return
    var amountGiven = 10000; // Ether given by a counter-party


    await accountModifiers.setModifiers(accounts[0], 20, 30, { from: accounts[feeAccount] });
    await accountModifiers.setModifiers(accounts[1], 40, 50, { from: accounts[feeAccount] });
    await dec.changeAccountModifiers(accountModifiers.address, { from: accounts[feeAccount] });

    await executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven, accounts[1]);

    // Based on the numbers above taker fee discount (account #1) is 40%
    // maker rebate (account #0) is 30%. For default fee of 0.3% (30 wei)
    // that would translate in (100% - 40%) * 30 wei = 18 wei taker fee and
    // 30% * 18 wei = 5.4 (~5) wei as maker rebate

    var result = await dec.balanceOf(tokenGive, accounts[0]);
    assert.equal(result.toString(), "950000", "Token sale for acc #0 was not successful");

    result = await dec.balanceOf(tokenGive, accounts[1]);
    assert.equal(result.toString(), "1050000", "Token purchase for acc #1 was not successful");

    result = await dec.balanceOf(tokenGet, accounts[0]);
    assert.equal(result.toString(), "110005", "Eth purchase for acc #0 was not successful");

    result = await dec.balanceOf(tokenGet, accounts[1]);
    assert.equal(result.toString(), "89982" /*100000-18*/, "Eth sale for acc #1 was not successful");

    result = await dec.balanceOf(tokenGet, accounts[feeAccount]);
    assert.equal(result.toNumber().valueOf(), 13 /*18-5*/, "Eth fee is incorrect");

  });


  it("Failed trades", async function () {

    var tokenGet = 0;       // Eth as a token type
    var tokenGive = token1.address;          // Other token type
    var amountGet = 2000;   // Eth wanted
    var amountGive = 10000; // Token given in return

    var fixedExpire = 1000000000; // High enough block number
    var fixedNonse = 0;

    // Tries to buy more than total order request
    var amountGiven1 = 3000;
    var traded = await executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven1, accounts[1], undefined, undefined, revertTransactionError);
    assert.equal(traded, false, "Transaction should not have passed");

    // Tries to offer more than the buyer has (using an account that didn't deposit)
    var amountGiven2 = 1000;

    traded = await executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven2, accounts[feeAccount], undefined, undefined, opcodeTransactionError);
    assert.equal(traded, false, "Transaction should not have passed");


    // Oversubscribed order (multiple trades with overflowing total)
    var amountGiven31 = 1500;
    traded = await executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven31, accounts[1], fixedExpire, fixedNonse, revertTransactionError);
    assert.equal(traded, true, "First trade should pass");

    var amountGiven32 = 700;

    traded = await executeOrder(dec, accounts[0], tokenGet, amountGet, tokenGive, amountGive, amountGiven32, accounts[1], fixedExpire, fixedNonse, revertTransactionError);
    assert.equal(traded, false, "Second trade should not have passed");

  });


  // Here we create a chain of 3 exchanges and try to migrate funds from 1st to 3rd
  it("Funds migration", async function () {

    var tempIntermediaryDec = await TokenStore.new(fee, dec.address, { from: accounts[feeAccount] });

    // Set a proper successor for the old exchange - temporary intermediary exchange
    await dec.deprecate(true, tempIntermediaryDec.address, { from: accounts[feeAccount] });

    var newDec = await TokenStore.new(fee, tempIntermediaryDec.address, { from: accounts[feeAccount] });

    // Set a proper successor for the temporary intermediary
    await tempIntermediaryDec.deprecate(true, newDec.address, { from: accounts[feeAccount] });


    // Check if the new exchange has zero balance and old exchange has it all

    var result = await newDec.balanceOf(token1.address, accounts[1]);
    assert.equal(result.toString(), "0", "Incorrect value of deposited token #1");

    result = await newDec.balanceOf(token2.address, accounts[1]);
    assert.equal(result.toString(), "0", "Incorrect value of deposited token #2");

    result = await newDec.balanceOf(0, accounts[1]);
    assert.equal(result.toString(), "0", "Incorrect value of deposited eth");

    result = await dec.balanceOf(token1.address, accounts[1]);
    assert.equal(result.toString(), depositedToken.toString(), "Incorrect value of deposited token #1");

    result = await dec.balanceOf(token2.address, accounts[1]);
    assert.equal(result.toString(), depositedToken.toString(), "Incorrect value of deposited token #2");

    result = await dec.balanceOf(0, accounts[1]);
    assert.equal(result.toString(), depositedEther.toString(), "Incorrect value of deposited eth");

    result = await token1.balanceOf(dec.address);
    assert.equal(result.toString(), (depositedToken * unlockedAccounts).toString(), "Token #1 stores incorrect value for dec");

    result = await token2.balanceOf(dec.address);
    assert.equal(result.toString(), (depositedToken * unlockedAccounts).toString(), "Token #2 stores incorrect value for dec");

    result = await token1.balanceOf(newDec.address);
    assert.equal(result.toString(), "0", "Token #1 stores incorrect value for newDec");

    result = await token2.balanceOf(newDec.address);
    assert.equal(result.toString(), "0", "Token #2 stores incorrect value for newDec");


    await dec.migrateFunds([token1.address, token2.address], { from: accounts[1] });


    // Check in reverse now - new exchange should have this user tokens/ether now

    result = await dec.balanceOf(token1.address, accounts[1]);
    assert.equal(result.toString(), "0", "Incorrect value of deposited token #1");

    result = await dec.balanceOf(token2.address, accounts[1]);
    assert.equal(result.toString(), "0", "Incorrect value of deposited token #2");

    result = await dec.balanceOf(0, accounts[1]);
    assert.equal(result.toString(), "0", "Incorrect value of deposited eth");

    result = await newDec.balanceOf(token1.address, accounts[1]);
    assert.equal(result.toString(), depositedToken.toString(), "Incorrect value of deposited token #1");

    result = await newDec.balanceOf(token2.address, accounts[1]);
    assert.equal(result.toString(), depositedToken.toString(), "Incorrect value of deposited token #2");

    result = await newDec.balanceOf(0, accounts[1]);
    assert.equal(result.toString(), depositedEther.toString(), "Incorrect value of deposited eth");

    result = await token1.balanceOf(dec.address);
    assert.equal(result.toString(), (depositedToken * (unlockedAccounts - 1)).toString(), "Token #1 stores incorrect value for dec");

    result = await token2.balanceOf(dec.address);
    assert.equal(result.toString(), (depositedToken * (unlockedAccounts - 1)).toString(), "Token #2 stores incorrect value for dec");

    result = await token1.balanceOf(newDec.address);
    assert.equal(result.toString(), depositedToken.toString(), "Token #1 stores incorrect value for newDec");

    result = await token2.balanceOf(newDec.address);
    assert.equal(result.toString(), depositedToken.toString(), "Token #2 stores incorrect value for newDec");


    // Bonus: check that normal users cannot access the migration helpers
    // so they cannot send to somebody else by mistake

    try {
      result = await newDec.depositForUser(accounts[0], { from: accounts[2], value: 1 });
      assert(false, "User was able to deposit to a different user address (shouldn't have been)");
    } catch (error) {
      assert.equal(error.message, revertTransactionError, "Incorrect error");
    }

    try {
      return token1.approve(newDec.address, 100, { from: accounts[2] });
      return newDec.depositTokenForUser(token1.address, 100, accounts[0], { from: accounts[2] });
      assert(false, "User was able to deposit to a different user address (shouldn't have been)");
    } catch (error) {
      assert.equal(error.message, revertTransactionError, "Incorrect error");
    }

  });

  afterEach('', async function () {

  });

});
