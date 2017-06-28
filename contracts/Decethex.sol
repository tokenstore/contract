pragma solidity ^0.4.11;

// ERC20 token protocol, see more details at
// https://theethereum.wiki/w/index.php/ERC20_Token_Standard
// And also https://github.com/ethereum/eips/issues/20

contract Token {
  function totalSupply() constant returns (uint256 supply);
  function balanceOf(address _owner) constant returns (uint256 balance);
  function transfer(address _to, uint256 _value) returns (bool success);
  function transferFrom(address _from, address _to, uint256 _value) returns (bool success);
  function approve(address _spender, uint256 _value) returns (bool success);
  function allowance(address _owner, address _spender) constant returns (uint256 remaining);

  event Transfer(address indexed _from, address indexed _to, uint256 _value);
  event Approval(address indexed _owner, address indexed _spender, uint256 _value);
}

// Safe mathematics to make the code more readable

contract SafeMath {
  function safeMul(uint a, uint b) internal returns (uint) {
    uint c = a * b;
    assert(a == 0 || c / a == b);
    return c;
  }

  function safeSub(uint a, uint b) internal returns (uint) {
    assert(b <= a);
    return a - b;
  }

  function safeAdd(uint a, uint b) internal returns (uint) {
    uint c = a + b;
    assert(c>=a && c>=b);
    return c;
  }
}

// Ownable interface to simplify owner checks

contract Ownable {
  address public owner;

  function Ownable() {
    owner = msg.sender;
  }

  modifier onlyOwner() {
    require(msg.sender == owner);
    _;
  }

  function transferOwnership(address newOwner) onlyOwner {
    if (newOwner != address(0)) {
      owner = newOwner;
    }
  }
}

// Deprecable interface to simplify owner checks

contract Deprecable is Ownable {
  // Address of a next version of the contract, can be used for user-triggered fund migrations
  address public successor;
  bool public deprecated;

  function Deprecable() {
    deprecated = false;
  }

  modifier deprecable() {
    require(!deprecated);
    _;
  }

  function deprecate(bool deprecated_, address successor_) onlyOwner {
    deprecated = deprecated_;
    successor = successor_;
  }
}

// Interface for trading discounts and rebates for specific accounts

contract AccountModifiers {
  function modifiers(address user) constant returns(uint takeFee, uint rebate);
}

// Exchange contract

contract Decethex is SafeMath, Ownable, Deprecable {

  // The account that will receive fees
  address feeAccount;

  // The account that stores fee discounts/rebates
  address accountModifiers;

  // We charge only the takers and this is the fee, percentage times 1 ether
  uint public fee;

  // Mapping of token addresses to mapping of account balances (token 0 means Ether)
  mapping (address => mapping (address => uint)) public tokens;

  // Mapping of user accounts to mapping of order hashes to uints (amount of order that has been filled)
  mapping (address => mapping (bytes32 => uint)) public orderFills;

  // Logging events
  // Note: Order creation is handled off-chain, see explanation further below
  event Cancel(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, address user, uint8 v, bytes32 r, bytes32 s);
  event Trade(address tokenGet, uint amountGet, address tokenGive, uint amountGive, address get, address give);
  event Deposit(address token, address user, uint amount, uint balance);
  event Withdraw(address token, address user, uint amount, uint balance);

  function Decethex(uint fee_) {
    feeAccount = owner;
    fee = fee_;
  }

  // Throw on default handler to prevent direct transactions of Ether
  function() {
    throw;
  }

  function changeFeeAccount(address feeAccount_) onlyOwner {
    feeAccount = feeAccount_;
  }

  function changeAccountModifiers(address accountModifiers_) onlyOwner {
    accountModifiers = accountModifiers_;
  }

  // Fee can only be decreased!
  function changeFee(uint fee_) onlyOwner {
    require(fee_ <= fee);
    fee = fee_;
  }

  function deposit() payable deprecable {
    tokens[0][msg.sender] = safeAdd(tokens[0][msg.sender], msg.value);
    Deposit(0, msg.sender, msg.value, tokens[0][msg.sender]);
  }

  function withdraw(uint amount) {
    require(tokens[0][msg.sender] >= amount);
    tokens[0][msg.sender] = safeSub(tokens[0][msg.sender], amount);
    if (!msg.sender.call.value(amount)()) {
      throw;
    }
    Withdraw(0, msg.sender, amount, tokens[0][msg.sender]);
  }

  function depositToken(address token, uint amount) deprecable {
    // Note that Token(address).approve(this, amount) needs to be called
    // first or this contract will not be able to do the transfer.
    require(token != 0);
    if (!Token(token).transferFrom(msg.sender, this, amount)) {
      throw;
    }
    tokens[token][msg.sender] = safeAdd(tokens[token][msg.sender], amount);
    Deposit(token, msg.sender, amount, tokens[token][msg.sender]);
  }

  function withdrawToken(address token, uint amount) {
    require(token != 0);
    require(tokens[token][msg.sender] >= amount);
    tokens[token][msg.sender] = safeSub(tokens[token][msg.sender], amount);
    if (!Token(token).transfer(msg.sender, amount)) {
      throw;
    }
    Withdraw(token, msg.sender, amount, tokens[token][msg.sender]);
  }

  function balanceOf(address token, address user) constant returns (uint) {
    return tokens[token][user];
  }

  // Note: Order creation happens off-chain but the orders are signed by creators,
  // we validate the contents and the creator address in the logic below

  function trade(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, address user, uint8 v, bytes32 r, bytes32 s, uint amount) {
    bytes32 hash = sha256(this, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);
    // Check order signatures and expiration, also check if not fulfilled yet
		if (ecrecover(sha3("\x19Ethereum Signed Message:\n32", hash), v, r, s) != user ||
      //block.number > expires ||
      safeAdd(orderFills[user][hash], amount) > amountGet) {
      throw;
    }
    tradeBalances(tokenGet, amountGet, tokenGive, amountGive, user, msg.sender, amount);
    orderFills[user][hash] = safeAdd(orderFills[user][hash], amount);
    Trade(tokenGet, amount, tokenGive, amountGive * amount / amountGet, user, msg.sender);
  }

  function tradeBalances(address tokenGet, uint amountGet, address tokenGive, uint amountGive,
    address user, address caller, uint amount) private {

    // Apply modifiers
    var (feeTake, rebate) = (fee, uint(0));
    if (accountModifiers != address(0)) {
      (feeTake, rebate) = AccountModifiers(accountModifiers).modifiers(user);
      // Check that the fee is never higher then the default one
      if (feeTake > fee) {
        feeTake = fee;
      }
      // Check that rebate is never higher than 100% (of the taker fee)
      if (rebate > 1 ether) {
        rebate = 0;
      }
    }

    uint feeTakeValue = safeMul(amount, feeTake) / (1 ether);
    uint rebateValue = safeMul(rebate, feeTakeValue) / (1 ether); // % of taker fee
    uint tokenGiveValue = safeMul(amountGive, amount) / amountGet; // Proportionate to request ratio
    tokens[tokenGet][user] = safeAdd(tokens[tokenGet][user], safeAdd(amount, rebateValue));
    tokens[tokenGet][caller] = safeSub(tokens[tokenGet][caller], safeAdd(amount, feeTakeValue));
    tokens[tokenGive][user] = safeSub(tokens[tokenGive][user], tokenGiveValue);
    tokens[tokenGive][caller] = safeAdd(tokens[tokenGive][caller], tokenGiveValue);
    tokens[tokenGet][feeAccount] = safeAdd(tokens[tokenGet][feeAccount], safeSub(feeTakeValue, rebateValue));
  }

  function testTrade(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, address user, uint8 v, bytes32 r, bytes32 s, uint amount, address sender) constant returns(bool) {
    if (tokens[tokenGet][sender] < amount ||
      availableVolume(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, user, v, r, s) < amount) {
      return false;
    }
    return true;
  }

  function availableVolume(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, address user, uint8 v, bytes32 r, bytes32 s) constant returns(uint) {
    bytes32 hash = sha256(this, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);
    if (ecrecover(sha3("\x19Ethereum Signed Message:\n32", hash),v,r,s) != user ||
      block.number > expires) {
      return 0;
    }
    uint available1 = safeSub(amountGet, orderFills[user][hash]);
    uint available2 = safeMul(tokens[tokenGive][user], amountGet) / amountGive;
    if (available1 < available2) return available1;
    return available2;
  }

  function amountFilled(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, address user) constant returns(uint) {
    bytes32 hash = sha256(this, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);
    return orderFills[user][hash];
  }

  function cancelOrder(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, uint8 v, bytes32 r, bytes32 s) {
    bytes32 hash = sha256(this, tokenGet, amountGet, tokenGive, amountGive, expires, nonce);
    if (!(ecrecover(sha3("\x19Ethereum Signed Message:\n32", hash), v, r, s) == msg.sender)) {
      throw;
    }
    orderFills[msg.sender][hash] = amountGet;
    Cancel(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, msg.sender, v, r, s);
  }
}
