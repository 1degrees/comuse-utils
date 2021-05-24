/*
 * @Author: Yue·jian
 * @Date: 2021-05-24 19:59:05
 * @LastEditors: Yue·jian
 * @LastEditTime: 2021-05-24 19:59:34
 * @Description: 文件用途描述
 */
import React, { useState, useEffect } from 'react';
import './index.css';

function IFrame(props) {
  const [src, setSrc] = useState();
  const [qrcode, setQrcode] = useState();

  useEffect(() => {
    const src = `${location.protocol}//${location.host}/pizza-taro/0.1.0/h5/#/pages/${props.componentName}/index`;
    setSrc(src);
    setQrcode(
      `https://www.kujiale.com/minicommon/api/weixin/qr/sun/code?appId=wx2fd91ed6ca5c850c&page=pages/${props.componentName}/index&scene=x`,
    );
  }, []);
  return (
    <div className="container">
      <div className="qrcode">
        <img className="qrcode__img" src={qrcode} />
        <div className="qrcode__text">
          h5 体验可能不完整
          <br />
          欢迎微信扫码体验
        </div>
      </div>
      <div className="device device-iphone-8">
        <div className="device-frame">
          <iframe src={src} width="280" height="500" className="iframe device-content" />
        </div>
        <div className="device-stripe"></div>
        <div className="device-header"></div>
        <div className="device-sensors"></div>
        <div className="device-btns"></div>
        <div className="device-power"></div>
      </div>
    </div>
  );
}

export default IFrame;
