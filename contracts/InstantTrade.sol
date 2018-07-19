pragma solidity ^0.4.13;

import "./TokenStore.sol";

contract ZeroExchange {
    
    address public TOKEN_TRANSFER_PROXY_CONTRACT;
    
    function fillOrKillOrder(
        address[5] orderAddresses,
        uint[6] orderValues,
        uint fillTakerTokenAmount,
        uint8 v,
        bytes32 r,
        bytes32 s)
        public {}
        
    function fillOrder(
          address[5] orderAddresses,
          uint[6] orderValues,
          uint fillTakerTokenAmount,
          bool shouldThrowOnInsufficientBalanceOrAllowance,
          uint8 v,
          bytes32 r,
          bytes32 s)
          public
          returns (uint filledTakerTokenAmount)
          {}
    
}

contract WETH {
 
    function deposit() public payable {}
    
    function withdraw(uint wad) public {}
}

contract InstantTrade is SafeMath, Ownable {

    address public Weth;
    address public ZeroX;
    address public ProxyZeroX;

   constructor(address _weth, address _zeroX) Ownable() public {
       Weth = _weth;
       ZeroX = _zeroX;
       ProxyZeroX = ZeroExchange(ZeroX).TOKEN_TRANSFER_PROXY_CONTRACT();
   }

  // This is needed so we can withdraw funds from other smart contracts
  function() public payable {
  }
  
  // End to end trading in a single call (Token Store, EtherDelta)
  function instantTrade(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive,
      uint _expires, uint _nonce, address _user, uint8 _v, bytes32 _r, bytes32 _s, uint _amount, address _store) external payable {
    
    // Fix max fee (0.4%) and always reserve it
    uint totalValue = safeMul(_amount, 1004) / 1000;
    
    // Paying with Ethereum or token? Deposit to the actual store
    if (_tokenGet == address(0)) {
      // Check amount of ether sent to make sure it's correct
      require(msg.value == totalValue);
      TokenStore(_store).deposit.value(totalValue)();
    } else {
      require(msg.value == 0);
        
      // Assuming user already approved transfer, transfer first to this contract
      require(Token(_tokenGet).transferFrom(msg.sender, this, totalValue));

      // Allow now actual store to deposit
      require(Token(_tokenGet).approve(_store, totalValue)); 
      TokenStore(_store).depositToken(_tokenGet, totalValue);
    }
    
    // Trade
    /*
    TokenStore(_store).trade(_tokenGet, _amountGet, _tokenGive, _amountGive,
      _expires, _nonce, _user, _v, _r, _s, _amount);
    */

    // Wrap trade function in a call to avoid a 'throw;' using up all gas.
    require(
        address(_store).call(
          bytes4(keccak256("trade(address,uint256,address,uint256,uint256,uint256,address,uint8,bytes32,bytes32,uint256)")),
          _tokenGet, _amountGet, _tokenGive, _amountGive,_expires, _nonce, _user, _v, _r, _s, _amount
        )
    );

    
    // Check how much did we get and how much should we send back
    totalValue = TokenStore(_store).balanceOf(_tokenGive, this);
    uint customerValue = safeMul(_amountGive, _amount) / _amountGet;
    
    // Now withdraw all the funds into this contract and then pass to the user
    if (_tokenGive == address(0)) {
      TokenStore(_store).withdraw(totalValue);
      msg.sender.transfer(customerValue);
    } else {
      TokenStore(_store).withdrawToken(_tokenGive, totalValue);
      require(Token(_tokenGive).transfer(msg.sender, customerValue));
    }
  }
  
  
  // End to end trading in a single call (0x with undefined taker and no ZRX fees: RadarRelay)
  function instantTrade0x(address[5] _orderAddresses, uint[6] _orderValues, uint8 _v, bytes32 _r, bytes32 _s, uint _amount) external payable {
            
    // require an undefined taker and 0 makerFee, 0 takerFee
    require(
      _orderAddresses[1] == address(0) 
      &&_orderValues[2] == 0 
      && _orderValues[3] == 0
    ); 
    

    // Fix max fee (0.4%) and always reserve it
    uint totalValue = safeMul(_amount, 1004) / 1000;
    
    // Paying with (wrapped) Ethereum or  other token? 
    if (/*takerToken*/_orderAddresses[3] == Weth) {
      // Check amount of ether sent to make sure it's correct
      require(msg.value == totalValue);
       // Convert to wrapped ETH
      WETH(Weth).deposit.value(msg.value)();
      require(Token(Weth).approve(ProxyZeroX, msg.value)); 
    } else {
        
      require(msg.value == 0);
      
      // Assuming user already approved transfer, transfer first to this contract
      require(Token(/*takerToken*/_orderAddresses[3]).transferFrom(msg.sender, this, totalValue));

      // Allow now actual store to deposit
      require(Token(/*takerToken*/_orderAddresses[3]).approve(ProxyZeroX, totalValue)); 
    } 
    
    // Trade and require that it was the full amount
    ZeroExchange(ZeroX).fillOrKillOrder(_orderAddresses, _orderValues, _amount, _v, _r, _s);

    
    // Check how much did we get and how much should we send back
    totalValue = Token(_orderAddresses[2]).balanceOf(this);
    uint customerValue = safeMul(/*makerTokenAmount*/_orderValues[0], _amount) / /*takerTokenAmount*/_orderValues[1];
    
    // Now unwrap funds and send to user
    if (/*makerToken*/_orderAddresses[2] == Weth) {
      WETH(Weth).withdraw(totalValue);
      msg.sender.transfer(customerValue);
    } else {
      require(Token(_orderAddresses[2]).transfer(msg.sender, customerValue));
    } 
    
  } 
  
 
  function withdrawFees(address _token) external onlyOwner {
    if (_token == address(0)) {
      msg.sender.transfer(address(this).balance);
    } else {
      uint amount = Token(_token).balanceOf(address(this));
      require(Token(_token).transfer(msg.sender, amount));
    }
  }  
}
