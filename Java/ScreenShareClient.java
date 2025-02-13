import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.image.BufferedImage;
import java.io.BufferedOutputStream;
import java.net.Socket;

public class ScreenShareClient{
    final int w = Toolkit.getDefaultToolkit().getScreenSize().width, h = Toolkit.getDefaultToolkit().getScreenSize().height;

    JFrame frame;
    JTextField text;
    JButton button;

    public static void main(String[] args) {
        new ScreenShareClient();
    }

    public ScreenShareClient() {
        frame = new JFrame("Client");
        frame.setBounds(0, 0, 300, 100);
        frame.setLayout(null);

        text = new JTextField();
        text.setVisible(true);
        text.setBounds(25, 15, 100, 50);


        button = new JButton("접속");
        button.setVisible(true);
        button.setBounds(125, 15, 50, 50);
        button.addActionListener(new ActionListener() {
            @Override
            public void actionPerformed(ActionEvent arg0) {
                ScreenShareClient.this.client_work();
            }

        });

        frame.add(text);
        frame.add(button);
        frame.setVisible(true);
    }

    public void client_work() {
        String serverip = text.getText();
        Socket socket = null;
        System.out.println("클라이언트 준비완료");

        try {
            socket = new Socket(serverip, 12345);
            System.out.println("접속완료 - 클라이언트");

            //BufferedImage image = new BufferedImage(1280, 720, BufferedImage.TYPE_3BYTE_BGR);

            BufferedImage image;
            Robot r = new Robot();
            BufferedOutputStream bout = new BufferedOutputStream(socket.getOutputStream());

            while(true) {
                //image.getGraphics().drawImage(r.createScreenCapture(new Rectangle(0,0,w,h)).getScaledInstance(1280, 720, Image.SCALE_SMOOTH), 0, 0, null);
                image = r.createScreenCapture(new Rectangle(0, 0, w, h));

                ImageIO.write(image, "bmp", bout);
                bout.flush();
            }

        } catch (Exception e) {

            e.printStackTrace();

            System.out.println("접속실패 - 클라이언트");
        }
    }
}