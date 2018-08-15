pragma solidity ^0.4.13;
// Max version 0.4.21 on mainnet, not set here to ease truffle use

import "./TokenStore.sol";

contract ZeroExchange {
  address public TOKEN_TRANSFER_PROXY_CONTRACT;
 
  function fillOrKillOrder(address[5] orderAddresses,uint[6] orderValues,uint fillTakerTokenAmount, uint8 v, bytes32 r, bytes32 s) public;
  function getOrderHash(address[5] orderAddresses, uint[6] orderValues) public view returns (bytes32);
  function isValidSignature(address signer,bytes32 hash,uint8 v,bytes32 r,bytes32 s)public view returns (bool);
  function getUnavailableTakerTokenAmount(bytes32 orderHash) public constant returns (uint);
}

contract WETH is Token {
  function deposit() public payable;
  function withdraw(uint wad) public;
}

contract InstantTrade is SafeMath, Ownable {

  address public wETH;
  address public zeroX;
  address public proxyZeroX;
  uint256 public fee = 1004; // 1004 is 0.4%  (amount * 1004 / 1000)
    
  mapping(address => bool) public allowedFallbacks; // Limit fallback to avoid accidental ETH transfers
    
  function InstantTrade(address _weth, address _zeroX) Ownable() public {
    wETH = _weth;
    zeroX = _zeroX;
    proxyZeroX = ZeroExchange(zeroX).TOKEN_TRANSFER_PROXY_CONTRACT();
       
    allowedFallbacks[wETH] = true;
  }
   
  // Only allow incoming ETH from known contracts (Exchange and WETH withdrawals)
  function() public payable {
    require(allowedFallbacks[msg.sender]);
  }
  
  // Set whether the fallback is allowed for an address
  function allowFallback(address _contract, bool _allowed) external onlyOwner {
    allowedFallbacks[_contract] = _allowed;
  }
  
  // Return the amount required to send or approve, including the fee. (in tokenGet, takerToken)
  function getFeeAmount(uint _amount) public view returns(uint) {
    return safeMul(_amount, fee) / 1000;
  }
  
  // Return the remaining volume of a Token Store order in tokenGet
  function availableVolume(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
    uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, address _store) external view returns(uint) {
   
    return TokenStore(_store).availableVolume(_tokenGet, _amountGet, _tokenGive, _amountGive,_expires, _nonce, _user, _v, _r, _s);
  }
  
  /* End to end trading in a single call (Token Store, EtherDelta)
     Approve 100.4% tokens or send 100.4% ETH to succeed.
  */
  function instantTrade(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
    uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, uint _amount, address _store) external payable {
    
    // Reserve the fee
    uint totalValue = getFeeAmount(_amount);
    
    // Paying with ETH or token? Deposit to the actual store
    if (_tokenGet == address(0)) {
    
      // Check amount of ETH sent to make sure it's correct
      require(msg.value == totalValue);
      // Deposit ETH
      TokenStore(_store).deposit.value(totalValue)();
    } else {
    
      // Make sure not to accept ETH when selling tokens
      require(msg.value == 0);
      
      // Assuming user already approved transfer, transfer to this contract
      require(Token(_tokenGet).transferFrom(msg.sender, this, totalValue));
      // Deposit token to the exchange
      require(Token(_tokenGet).approve(_store, totalValue)); 
      TokenStore(_store).depositToken(_tokenGet, totalValue);
    }
    

    // Wrap trade function in a call to avoid a 'throw' (EtherDelta) using up all gas, returns (bool success)
    require(
      address(_store).call(
        bytes4(0x0a19b14a), // precalculated Hash of the line below
        // bytes4(keccak256("trade(address,uint256,address,uint256,uint256,uint256,address,uint8,bytes32,bytes32,uint256)")),  
        _tokenGet, _amountGet, _tokenGive, _amountGive,_expires, _nonce, _user, _v, _r, _s, _amount
      )
    );

    // How much did we end up with
    totalValue = TokenStore(_store).balanceOf(_tokenGive, this);
    uint customerValue = safeMul(_amountGive, _amount) / _amountGet;
    
    // Double check to make sure we aren't somehow losing funds
    require(customerValue <= totalValue);
    
    // Return funds to the user
    if (_tokenGive == address(0)) {
      // Withdraw ETH
      TokenStore(_store).withdraw(totalValue);
      // Send ETH back to sender
      msg.sender.transfer(customerValue);
    } else {
      // Withdraw tokens
      TokenStore(_store).withdrawToken(_tokenGive, totalValue);
      // Send tokens back to sender
      require(Token(_tokenGive).transfer(msg.sender, customerValue));
    }
  }
  

  
  // Return the remaining volume of a 0x order in takerToken (orderAddresses[1])
  function availableVolume0x(address[5] _orderAddresses, uint[6] _orderValues, uint8 _v, bytes32 _r, bytes32 _s) external view returns(uint) {
    ZeroExchange zrx = ZeroExchange(zeroX);
    bytes32 orderHash = zrx.getOrderHash(_orderAddresses, _orderValues);
    
    // Check whether the order is valid and return available instead of filled tokens
    if(zrx.isValidSignature(_orderAddresses[0], orderHash, _v, _r, _s)) {
      uint filled = zrx.getUnavailableTakerTokenAmount(orderHash);
      if(filled < _orderValues[1]) {
        return (_orderValues[1] - filled);
      } else {
        return 0;
      }
    } else {
      return 0;
    }
  }

  
  /* End to end trading in a single call (0x with open orderbook and 0 ZRX fees)
     Approve 100.4% tokens or send 100.4% ETH to succeed.
  */
  function instantTrade0x(address[5] _orderAddresses, uint[6] _orderValues, uint8 _v, bytes32 _r, bytes32 _s, uint _amount) external payable {
            
    // Require an undefined taker and 0 maker and taker fee
    require(
      _orderAddresses[1] == address(0) 
      && _orderValues[2] == 0 
      && _orderValues[3] == 0
    ); 
    
    WETH wToken = WETH(wETH);
    
    // Reserve the fee
    uint totalValue = getFeeAmount(_amount);
    
    // Paying with W-ETH or token? 
    if (/*takerToken*/ _orderAddresses[3] == wETH) {
        
      // Check amount of ETH sent to make sure it's correct
      require(msg.value == totalValue);
      
       // Convert to wrapped ETH and approve for trading
      wToken.deposit.value(msg.value)();
      require(wToken.approve(proxyZeroX, msg.value)); 
    } else {
        
      // Make sure not to accept ETH when selling tokens
      require(msg.value == 0);
      
      Token token = Token(/*takerToken*/ _orderAddresses[3]);
      
      // Assuming user already approved transfer, transfer to this contract
      require(token.transferFrom(msg.sender, this, totalValue));
      // Approve token for trading
      require(token.approve(proxyZeroX, totalValue)); 
    } 
    
    // Trade for the full amount only (revert otherwise)
    ZeroExchange(zeroX).fillOrKillOrder(_orderAddresses, _orderValues, _amount, _v, _r, _s);

    // Check how much did we get and how much should we send back
    uint customerValue = safeMul(_orderValues[0], _amount) / _orderValues[1]; // (takerTokenAmount * _amount) / makerTokenAmount
    
    // Send funds to the user
    if (/*makerToken*/ _orderAddresses[2] == wETH) {
      // Unwrap WETH
      totalValue = wToken.balanceOf(this);
      wToken.withdraw(totalValue);
      // Send ETH back to sender
      msg.sender.transfer(customerValue);
    } else {
      // Send tokens back to sender
      require(Token(_orderAddresses[2]).transfer(msg.sender, customerValue));
    }  
  } 
  
  // Withdraw funds earned from fees
  function withdrawFees(address _token) external onlyOwner {
    if (_token == address(0)) {
      msg.sender.transfer(address(this).balance);
    } else {
      Token token = Token(_token);
      require(token.transfer(msg.sender, token.balanceOf(address(this))));
    }
  }
  
  // Withdraw funds that might be left in the exchange contracts
  function withdrawStore(address _token, address _store) external onlyOwner {
    TokenStore store = TokenStore(_store);
    
    if (_token == address(0)) {
      store.withdraw(store.balanceOf(_token, this));
    } else {
      store.withdrawToken(_token, store.balanceOf(_token, this));
    }
  }
  
}
